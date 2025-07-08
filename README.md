# 📸 Chrome Screen Capture API

> **Backend API for Chrome Screen Capture Extension with AWS S3 Integration**

A robust Node.js API server that handles file uploads, case management, and secure storage for Chrome screen capture extensions. Built with Express.js, AWS S3, and PostgreSQL support.

## 🌟 Features

### 🔐 **Authentication & Security**
- JWT-based authentication
- Role-based access control (User/Admin)
- Rate limiting protection
- CORS configuration for Chrome extensions
- Helmet security headers

### 📁 **Case Management**
- Create, read, update, delete cases
- Filter and search functionality
- Bulk operations support
- Tag system for organization
- Export cases to CSV
- Real-time statistics

### 📤 **File Upload & Storage**
- AWS S3 integration with presigned URLs
- Support for screenshots (PNG, JPEG, WebP, GIF)
- Support for videos (WebM, MP4, QuickTime)
- Direct browser-to-S3 uploads (no server bandwidth)
- File validation and security checks
- Automatic cleanup and lifecycle management

### 📊 **Analytics & Monitoring**
- Upload statistics and metrics
- Storage cost estimation
- Health check endpoints
- Detailed API testing suite
- Performance monitoring

### 🛠️ **Developer Experience**
- Comprehensive API documentation
- Automated setup scripts
- Docker support for production
- Database migration tools
- TypeScript-ready structure

## 🚀 Quick Start

### Prerequisites

- **Node.js** 16+ and npm 8+
- **AWS Account** with S3 access

### 1️⃣ **Clone & Install**

```bash
cd chrome-screen-capture-api
npm install
```

### 2️⃣ **Environment Setup**

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your settings
nano .env
```

**Required Environment Variables:**
```bash
# AWS Configuration (Required)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-southeast-1
AWS_S3_BUCKET_NAME=your-unique-bucket-name

# Server Configuration
PORT=3001
NODE_ENV=development
JWT_SECRET=your-secure-jwt-secret

# File Upload Settings
MAX_FILE_SIZE=104857600
ALLOWED_FILE_TYPES=image/png,image/jpeg,image/webp,video/webm,video/mp4
```

### 3️⃣ **AWS Setup**

```bash
# Automated AWS S3 setup
npm run setup:aws

### 4️⃣ **Start Development Server**

```bash
# Start development server with hot reload
npm run dev

# Or start production server
npm start
```

**🎉 Success!** Your API should be running at `http://localhost:3001`

## 📖 API Documentation

### 🔐 **Authentication Endpoints**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | User login with username/password |
| `POST` | `/api/auth/logout` | User logout |
| `GET` | `/api/auth/me` | Get current user info |
| `POST` | `/api/auth/refresh` | Refresh JWT token |

### 📁 **Case Management Endpoints**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cases` | List cases with filtering & pagination |
| `POST` | `/api/cases` | Create new case |
| `GET` | `/api/cases/:id` | Get case by ID |
| `PATCH` | `/api/cases/:id` | Update case |
| `DELETE` | `/api/cases/:id` | Delete case (Admin only) |
| `GET` | `/api/cases/stats` | Get case statistics |
| `GET` | `/api/cases/export` | Export cases to CSV |

### 📤 **Upload Endpoints**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload/presigned-url` | Generate presigned URL for upload |
| `POST` | `/api/upload/confirm` | Confirm successful upload |
| `DELETE` | `/api/upload/file` | Delete file |
| `GET` | `/api/upload/cases/:id/files` | Get files for case |
| `GET` | `/api/upload/download/:key` | Get download URL |
| `GET` | `/api/upload/stats` | Get upload statistics |

### 🏥 **Health & Monitoring**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Basic health check |
| `GET` | `/api/health/detailed` | Detailed health with service status |
| `GET` | `/api` | API information and available endpoints |

## 💾 Database Configuration

### **Default: In-Memory Storage**
The API works out-of-the-box with JSON file storage for development:

```javascript
// Uses files in /data directory
- cases.json    // Case data
- files.json    // File metadata
- users.json    // User accounts
```

## 🔧 Configuration Options

### **File Upload Settings**

```bash
# Maximum file size (bytes)
MAX_FILE_SIZE=104857600  # 100MB

# Allowed MIME types
ALLOWED_FILE_TYPES=image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/quicktime

# Upload timeout (milliseconds)
UPLOAD_TIMEOUT=600000  # 10 minutes

# Presigned URL expiration (seconds)
PRESIGNED_URL_EXPIRATION=3600  # 1 hour
```

### **Security Settings**

```bash
# JWT configuration
JWT_SECRET=your-super-secure-secret
JWT_EXPIRES_IN=24h

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100      # 100 requests per window
AUTH_RATE_LIMIT_MAX=5            # 5 auth attempts per window

# Password hashing
BCRYPT_ROUNDS=12
```

**❌ AWS Credentials Error**
```bash
# Check environment variables
node -e "require('dotenv').config(); console.log('✓ AWS_ACCESS_KEY_ID:', !!process.env.AWS_ACCESS_KEY_ID)"
