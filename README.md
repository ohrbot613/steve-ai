# Steve AI - Intelligent PDF Automation

An intelligent PDF automation system for processing invoices and statements with Xero integration.

## 📋 Prerequisites

- Node.js (v16 or higher)
- MongoDB instance (local or cloud)
- Xero API credentials
- OpenRouter API key
- Google AI API key
- Langfuse account (for LLM observability) - [Sign up here](https://cloud.langfuse.com)

## 🚀 Installation

### 1. Clone and Install Dependencies

```bash
# Install server dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

### 2. Environment Configuration

Create a `.env` file in the root directory based on `.env.example`:

```bash
cp .env.example .env
```

Fill in the following environment variables:

```env
# API Keys
OPEN_ROUTER=your_openrouter_api_key
AI_KEY=your_google_ai_key

# Xero Configuration
XERO_CLIENT_ID=your_xero_client_id
XERO_CLIENT_SECRET=your_xero_client_secret
XERO_REDIRECT_URI=https://yourdomain.com/api/v1/auth/register-xero-callback

# Langfuse Configuration (LLM Observability)
# Get your keys from https://cloud.langfuse.com or your self-hosted instance
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
# Optional: Only needed if using self-hosted Langfuse
# LANGFUSE_HOST=https://cloud.langfuse.com

# Security
JWT_SECRET=your_secure_random_string_here

# Server
PORT=3001

# Database
# For remote MongoDB (MongoDB Atlas, etc.):
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority

# For local MongoDB (development):
# MONGO_URI=mongodb://localhost:27017/pdf-automation
# Or leave unset to use default local connection
```

### 3. Build Client

```bash
# Build React client
npm run build:client
```

## 💻 Development

### Run Development Server

```bash
# Backend server (with auto-reload)
npm run dev

# Frontend development server (separate terminal)
npm run dev:client
```

## 🏭 Production Deployment

### Pre-Deployment Checklist

- [ ] Update `.env` with production values
- [ ] Set `XERO_REDIRECT_URI` to production URL
- [ ] Ensure MongoDB is accessible from production server
- [ ] Build client assets: `npm run build:client`
- [ ] Remove/backup test files in `/files/` and `/media/` directories
- [ ] Verify all API keys are valid

### Deploy Steps

1. **Update Environment Variables**
   ```bash
   # Update .env with production URLs and credentials
   # DO NOT commit .env to version control
   ```

2. **Build React Client**
   ```bash
   npm run build:client
   ```
   This will compile the React app and copy files to:
   - `views/index.html` - Main entry point
   - `public/assets/` - Compiled JS and CSS

3. **Start Production Server**
   ```bash
   npm start
   ```

### Recommended Production Setup

- **Process Manager**: Use PM2 for process management
  ```bash
  npm install -g pm2
  pm2 start server.js --name steve-ai
  pm2 save
  pm2 startup
  ```

- **Reverse Proxy**: Configure Nginx/Apache for SSL and routing
- **Environment Variables**: Use server environment variables instead of `.env` file
- **Logging**: Implement proper logging (consider Winston or Morgan)
- **Monitoring**: Set up monitoring and alerts

### Server Configuration Notes

- Default port: 3001 (configurable via `PORT` environment variable)
- Ensure firewall allows traffic on the configured port
- SSL certificate recommended for production
- Database backups should be automated

## 📁 Project Structure

```
.
├── client/                 # React frontend source
│   ├── src/
│   │   ├── pages/         # Page components
│   │   ├── componentes/   # Reusable components
│   │   └── scss/          # Component styles
│   └── dist/              # Built files (generated after build)
├── controllers/           # Route controllers
├── modals/                # Database models
├── routes/                # API routes
├── views/                 # Compiled React app (index.html)
├── public/                # Static assets
│   ├── assets/           # Compiled JS/CSS from React build
│   └── js/               # Legacy JS (archived to .old)
├── .old/                  # Legacy frontend files (EJS, SCSS, CSS)
├── media/                 # Uploaded files (in .gitignore)
├── files/                 # Sample/test files (in .gitignore)
├── .env                   # Environment variables (DO NOT COMMIT)
├── .env.example           # Environment template
├── server.js              # Server entry point
├── app.js                 # Express app configuration
└── package.json           # Dependencies and scripts
```

## 🔒 Security Considerations

### Before Deployment

1. **API Keys**: Never commit `.env` file to version control
2. **Test Data**: Remove all sample PDFs and test files
3. **Debug Code**: Console.log statements have been removed
4. **Database**: Ensure MongoDB has proper authentication
5. **CORS**: Configure CORS for production domain only
6. **Rate Limiting**: Consider implementing rate limiting for API endpoints

### Environment Variables to Update

- `XERO_REDIRECT_URI`: Must match production domain
- `JWT_SECRET`: Generate a strong random secret
- All API keys must be production keys

## 🛠️ Available Scripts

```bash
npm start              # Start production server
npm run dev            # Start development server with auto-reload
npm run dev:client     # Start client development server
npm run build:client   # Build client for production
```

## 📝 API Endpoints

### Authentication
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/logout` - User logout
- `GET /api/v1/auth/register-xero-callback` - Xero OAuth callback

### Invoices
- `GET /api/v1/invoice/get-suppliers` - Get suppliers list
- `GET /api/v1/invoice/get-logs` - Get logs for supplier
- `GET /api/v1/invoice/get-all-logs` - Get all logs
- `GET /api/v1/invoice/get-invoices` - Get invoices for supplier
- `GET /api/v1/invoice/get-all-invoices` - Get all invoices

### LangChain
- `POST /api/v1/langchain/langchain-agent` - LangChain agent with tools (tracked in Langfuse)
- `GET /api/v1/langchain/test-tools` - Test LangChain tools

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check `MONGO_URI` is correct
   - Verify network access to MongoDB
   - Ensure IP whitelist includes server IP

2. **Xero Authentication Fails**
   - Verify `XERO_REDIRECT_URI` matches Xero app settings
   - Check client ID and secret are correct
   - Ensure redirect URI uses HTTPS in production

3. **Port Already in Use**
   - Change `PORT` in `.env` file
   - Check for other processes using the port

4. **Client Build Fails**
   - Clear `client/dist` and rebuild
   - Check for Node.js version compatibility

## 📞 Support

For issues or questions, please check the documentation or contact the development team.

## 📄 License

ISC
