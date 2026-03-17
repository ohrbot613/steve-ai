const crypto = require("crypto");
const { AuthorizationCode } = require('simple-oauth2');
const { tryCatchAsync } = require('./ErrorController');
const axios = require("axios");
const User = require('../modals/userModal');
const XeroTenants = require('../modals/xeroTenantsModal');
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
exports.protect = tryCatchAsync(async (req, res, next) => {
    // Only accept tokens from cookies or Authorization header — never from query strings (prevents token leakage in logs/referrers)
    const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        // Check if it's an API request
        if (req.originalUrl?.startsWith('/api/') || req.path?.startsWith('/api/')) {
            return res.status(401).json({ 
                status: 'error', 
                message: 'Not authenticated',
                authenticated: false 
            });
        }
        return res.redirect('/login')
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-resetToken -resetTokenTTL')
        
        if (!user) {
            // User not found in database
            if (req.originalUrl?.startsWith('/api/') || req.path?.startsWith('/api/')) {
                return res.status(401).json({ 
                    status: 'error', 
                    message: 'User not found',
                    authenticated: false 
                });
            }
            return res.redirect('/login')
        }
        
        req.user = user
        
        // Final safety check - ensure user exists before proceeding
        if (!req.user) {
            if (req.originalUrl?.startsWith('/api/') || req.path?.startsWith('/api/')) {
                return res.status(401).json({ 
                    status: 'error', 
                    message: 'Authentication failed',
                    authenticated: false 
                });
            }
            return res.redirect('/login')
        }
    } catch (err) {
        // Check if it's an API request
        if (req.originalUrl?.startsWith('/api/') || req.path?.startsWith('/api/')) {
            return res.status(401).json({ 
                status: 'error', 
                message: 'Invalid or expired token',
                authenticated: false 
            });
        }
        return res.redirect('/login')
    }
    
    // Only call next() if we have a valid authenticated user
    if (!req.user) {
        if (req.originalUrl?.startsWith('/api/') || req.path?.startsWith('/api/')) {
            return res.status(401).json({ 
                status: 'error', 
                message: 'Authentication required',
                authenticated: false 
            });
        }
        return res.redirect('/login')
    }
    
    next();
})


exports.xeroClient = tryCatchAsync(async (req, res, next) => {
    const client = new AuthorizationCode({
        client: {
            id: process.env.XERO_CLIENT_ID,
            secret: process.env.XERO_CLIENT_SECRET,
        },
        auth: {
            tokenHost: 'https://identity.xero.com/connect/token',
            authorizePath: 'https://login.xero.com/identity/connect/authorize',
            tokenPath: '/connect/token',
        },
    });

    req.xeroClient = client;
    req.xeroScopes = "openid profile email offline_access accounting.contacts accounting.transactions accounting.reports.read";
    req.xeroRedirectUri = `${process.env.XERO_REDIRECT_URI}`;
    next();
})

exports.registerXero = tryCatchAsync(async (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    res.cookie('xero_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 minutes
    });
    const client = req.xeroClient;
    const authorizationUri = client.authorizeURL({
        redirect_uri: req.xeroRedirectUri,
        scope: req.xeroScopes,
        state,
    });

    res.redirect(authorizationUri);
})

exports.registerXeroCallback = tryCatchAsync(async (req, res) => {
    const state = req.query.state;
    const savedState = req.cookies?.xero_oauth_state;
    res.clearCookie('xero_oauth_state', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
    if (!state || !savedState || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(savedState))) {
        return res.status(403).json({ status: 'error', message: 'Invalid or expired OAuth state' });
    }
    const code = req.query.code;
    const client = req.xeroClient;
    const tokenParams = {
        code,
        redirect_uri: req.xeroRedirectUri,
        scope: req.xeroScopes,
    };

    const accessToken = await client.getToken(tokenParams);

    const connections = await axios.get("https://api.xero.com/connections", {
        headers: { Authorization: `Bearer ${accessToken.token.access_token}` },
    });

    const tenantId = connections.data[0].tenantId

    // Fetch tenant name from Xero API
    let tenantName = `Tenant ${tenantId}`;
    try {
        const orgResponse = await axios.get("https://api.xero.com/api.xro/2.0/Organisation", {
            headers: {
                Authorization: `Bearer ${accessToken.token.access_token}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });
        if (orgResponse.data && orgResponse.data.Organisations && orgResponse.data.Organisations.length > 0) {
            tenantName = orgResponse.data.Organisations[0].Name || tenantName;
        }
    } catch (error) {
        console.warn(`Could not fetch tenant name from Xero API: ${error.message}`);
    }

    // Store in XeroTenants document (upsert by tenantId). Persist scope so we know what was granted.
    const authData = {
        accessToken: accessToken.token.access_token,
        refreshToken: accessToken.token.refresh_token,
        expiryTime: accessToken.token.expires_at,
    };
    if (accessToken.token.scope) authData.scope = accessToken.token.scope;
    const xeroTenant = await XeroTenants.findOneAndUpdate(
        { tenantId: tenantId },
        {
            tenantId: tenantId,
            tenantName: tenantName,
            authData,
            modifiedLast: Date.now(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Associate current user with this tenant (all users with this tenant will get the updated credentials)
    if (req.user && xeroTenant) {
        await User.findByIdAndUpdate(
            req.user._id,
            { tenant: xeroTenant._id },
            { new: true }
        );
    }

    // Redirect to frontend with success parameter
    return res.redirect('/suppliers?xeroConnected=success');
})

exports.checkXeroStatus = tryCatchAsync(async (req, res) => {
  // Only fetch the fields we need — never load tokens into memory for a status check
  const xeroTenant = await XeroTenants.findOne()
    .select('tenantId tenantName authData.refreshToken')
    .lean();

  if (!xeroTenant?.authData?.refreshToken) {
    return res.status(200).json({ 
      connected: false,
      message: 'Xero is not connected'
    });
  }

  return res.status(200).json({ 
    connected: true,
    tenantName: xeroTenant.tenantName || 'Connected',
    tenantId: xeroTenant.tenantId
  });
});

exports.xeroTokenInfo = tryCatchAsync(async (req, res, next) => {
   const client = req.xeroClient;

  // Get Xero tenant (use first available tenant, or implement tenant selection logic)
  const xeroTenant = await XeroTenants.findOne().lean();
  if (!xeroTenant?.authData?.refreshToken) {
    throw new Error("No Xero token found. Please register Xero account first.");
  }

  const scope = xeroTenant.authData.scope || "openid profile email offline_access accounting.contacts accounting.transactions accounting.reports.read";
  let tokenSet = client.createToken({
    access_token: xeroTenant.authData.accessToken,
    refresh_token: xeroTenant.authData.refreshToken,
    expires_at: xeroTenant.authData.expiryTime,
    token_type: "Bearer",
    scope,
  });

  if (tokenSet.expired()) {
    if (process.env.NODE_ENV !== 'production') {
      console.log("Xero token expired, refreshing...");
    }
    tokenSet = await tokenSet.refresh();
    const updateFields = {
      'authData.accessToken': tokenSet.token.access_token,
      'authData.refreshToken': tokenSet.token.refresh_token,
      'authData.expiryTime': tokenSet.token.expires_at,
      modifiedLast: Date.now(),
    };
    if (tokenSet.token.scope) updateFields['authData.scope'] = tokenSet.token.scope;
    await XeroTenants.findOneAndUpdate(
      { tenantId: xeroTenant.tenantId },
      updateFields
    );
  }

  // ALWAYS use tokenSet
  req.xeroAccessToken = tokenSet.token.access_token;
  req.xeroTenantId = xeroTenant.tenantId;
next()
})

/** Same as xeroTokenInfo but does not throw when Xero is not connected; just calls next() without setting req.xeroAccessToken. */
exports.optionalXeroTokenInfo = tryCatchAsync(async (req, res, next) => {
  const client = req.xeroClient;
  if (!client) return next();

  const xeroTenant = await XeroTenants.findOne().lean();
  if (!xeroTenant?.authData?.refreshToken) return next();

  const scope = xeroTenant.authData.scope || "openid profile email offline_access accounting.contacts accounting.transactions accounting.reports.read";
  let tokenSet = client.createToken({
    access_token: xeroTenant.authData.accessToken,
    refresh_token: xeroTenant.authData.refreshToken,
    expires_at: xeroTenant.authData.expiryTime,
    token_type: "Bearer",
    scope,
  });

  if (tokenSet.expired()) {
    try {
      tokenSet = await tokenSet.refresh();
      const updateFields = {
        'authData.accessToken': tokenSet.token.access_token,
        'authData.refreshToken': tokenSet.token.refresh_token,
        'authData.expiryTime': tokenSet.token.expires_at,
        modifiedLast: Date.now(),
      };
      if (tokenSet.token.scope) updateFields['authData.scope'] = tokenSet.token.scope;
      await XeroTenants.findOneAndUpdate(
        { tenantId: xeroTenant.tenantId },
        updateFields
      );
    } catch (err) {
      return next();
    }
  }

  req.xeroAccessToken = tokenSet.token.access_token;
  req.xeroTenantId = xeroTenant.tenantId;
  next();
});

exports.createUser = tryCatchAsync(async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ status: "error", message: "Name, email, and password are required" });
    }

    if (password.length < 8) {
        return res.status(400).json({ status: "error", message: "Password must be at least 8 characters" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
        return res.status(400).json({ status: "error", message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        password: hashedPassword
    });

    const token = jwt.sign(
        { userId: newUser._id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
    res.status(201)
        .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        })
        .json({
            status: "success",
            user: { id: newUser._id, name: newUser.name, email: newUser.email }
        });
})

exports.createUserForTenant = tryCatchAsync(async (req, res) => {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
        return res.status(400).json({
            status: "error",
            message: "Name, email, and password are required"
        });
    }

    if (password.length < 8) {
        return res.status(400).json({
            status: "error",
            message: "Password must be at least 8 characters"
        });
    }

    // Get current user's tenant ObjectId (references XeroTenants)
    const currentUser = req.user;
    const tenantId = currentUser.tenant; // This is the ObjectId reference to XeroTenants
    
    if (!tenantId) {
        return res.status(400).json({
            status: "error",
            message: "Current user does not have a tenant assigned"
        });
    }

    // Check if email already exists
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
        return res.status(400).json({
            status: "error",
            message: "Email already exists"
        });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user with the same tenant ObjectId as the current user
    const newUser = await User.create({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        tenant: tenantId // Use the same tenant ObjectId from the current user
    });

    res.status(201).json({
        status: "success",
        message: "User created successfully",
        user: {
            id: newUser._id,
            name: newUser.name,
            email: newUser.email
        }
    });
})


exports.login = tryCatchAsync(async (req, res) => {
    const { password, email } = req.body;

    // Input validation
    if (!email || !password) {
        return res.status(400).json({ 
            status: "error", 
            message: "Email and password are required" 
        });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    // SECURITY: Don't reveal if user exists or not (prevents user enumeration)
    // Use generic error message for both cases
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.status(401).json({ 
            status: "error", 
            message: "Invalid email or password" 
        });
    }

    const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    res.status(200)
        .cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        })
        .json({
            status: "success",
        });
})


exports.logout = tryCatchAsync(async (req, res) => {
  res
    .clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    })
    .status(200)
    .json({
      status: 'success',
      message: 'Logged out successfully'
    });
});
