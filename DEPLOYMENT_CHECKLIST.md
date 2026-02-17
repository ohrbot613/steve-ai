# 🚀 Pre-Deployment Checklist

## ✅ Completed Fixes

The following issues have been automatically resolved:

- [x] Updated `.gitignore` to exclude test files, build outputs, and sensitive data
- [x] Created `.env.example` template with placeholder values
- [x] Added production scripts to `package.json` (`start`, `build:client`, `build:scss`)
- [x] Removed duplicate file `views/home copy.ejs`
- [x] Fixed port configuration inconsistency (now defaults to 3001)
- [x] Removed debug `console.log` statements from production code
- [x] Created comprehensive `README.md` with deployment instructions

## ⚠️ Manual Actions Required Before Deployment

### 1. Environment Variables (CRITICAL)

**Action**: Update your production `.env` file with production values

Current `.env` has localhost URLs that MUST be changed:

```bash
# CHANGE THIS:
XERO_REDIRECT_URI=http://localhost:3002/api/v1/auth/register-xero-callback

# TO YOUR PRODUCTION URL:
XERO_REDIRECT_URI=https://yourdomain.com/api/v1/auth/register-xero-callback
```

**Important**: 
- Update the Xero redirect URI in your Xero Developer Console to match
- Generate a new, strong JWT_SECRET for production
- Verify all API keys are production-ready

### 2. Test Files Cleanup (RECOMMENDED)

**Action**: Review and remove/backup test files

The following directories contain sample/test data:

```bash
/files/                 # Contains 6 sample PDF/Excel files
/media/files/          # Contains 11 test PDF files
```

**Options**:
- Delete these directories if not needed
- Move to a backup location
- They are now in `.gitignore` so won't be committed

### 3. Build for Production (REQUIRED)

Before deploying, run these commands:

```bash
# Build client
npm run build:client

# Build SCSS
npm run build:scss

# Verify build succeeded
ls client/dist/        # Should show built files
ls public/css/         # Should show compiled CSS
```

### 4. Database Verification (CRITICAL)

**Action**: Verify MongoDB connection for production

- [ ] MongoDB instance is accessible from production server
- [ ] IP whitelist includes production server IP
- [ ] Username/password are correct in `.env`
- [ ] Database has proper indexes set up
- [ ] Backup strategy is configured

### 5. API Keys Validation (CRITICAL)

**Action**: Verify all API keys work in production

- [ ] OpenRouter API key is valid and has sufficient credits
- [ ] Google AI API key is valid and has proper quotas
- [ ] Xero credentials work with production domain
- [ ] Test authentication flow after deployment

### 6. Security Review (RECOMMENDED)

**Action**: Additional security measures

- [ ] Set up HTTPS/SSL certificate (required for production)
- [ ] Configure CORS to only allow your frontend domain
- [ ] Set up rate limiting on API endpoints
- [ ] Enable MongoDB authentication
- [ ] Review user authentication security
- [ ] Set secure cookie options in production

### 7. Server Configuration (RECOMMENDED)

**Action**: Production server setup

- [ ] Use PM2 or similar process manager for auto-restart
- [ ] Configure Nginx/Apache as reverse proxy
- [ ] Set up firewall rules
- [ ] Configure logging (Winston/Morgan)
- [ ] Set up monitoring and alerts
- [ ] Schedule automatic backups

### 8. Testing Before Going Live (CRITICAL)

**Action**: Test all functionality

- [ ] User login/logout works
- [ ] File upload works
- [ ] PDF processing works
- [ ] Xero integration works
- [ ] All pages load correctly
- [ ] Error handling works properly
- [ ] Mobile responsiveness

## 📋 Quick Deployment Commands

```bash
# 1. Update environment variables
nano .env  # or use your editor

# 2. Build assets
npm run build:client
npm run build:scss

# 3. Test locally first
npm start

# 4. Deploy to production server
# (depends on your hosting provider)

# 5. Start with PM2 (recommended)
pm2 start server.js --name steve-ai
pm2 save
pm2 startup
```

## 🔍 Post-Deployment Verification

After deployment, verify:

- [ ] Server is running on correct port
- [ ] Can access the application via browser
- [ ] Login functionality works
- [ ] File uploads work
- [ ] No console errors in browser
- [ ] Database connections are working
- [ ] API responses are correct
- [ ] SSL certificate is valid

## 📝 Notes

### Files That Should NOT Be Deployed

These are automatically excluded by `.gitignore`:
- `.env` (use server environment variables instead)
- `node_modules/` (run npm install on server)
- `.old/` directory
- `files/` and `media/` directories (test data)
- `client/dist/` (rebuild on server or include in build pipeline)

### Files That MUST Be Deployed

- All source code files
- `package.json` and `package-lock.json`
- `.env.example` (as reference)
- Built assets (if not building on server)
- `README.md` and documentation

## ⚡ Quick Reference

**Start production**: `npm start`  
**View logs**: `pm2 logs steve-ai`  
**Restart**: `pm2 restart steve-ai`  
**Monitor**: `pm2 monit`

## 🆘 Emergency Contacts

If issues arise post-deployment:
1. Check PM2 logs: `pm2 logs`
2. Check server logs
3. Verify environment variables are set
4. Check MongoDB connection
5. Review README.md troubleshooting section

---

Good luck with your deployment! 🚀
