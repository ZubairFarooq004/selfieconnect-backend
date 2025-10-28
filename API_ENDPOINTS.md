# Selfie Connect Backend API Documentation

## 🚀 Base URL
- **Local**: `http://localhost:5000`
- **Production**: `https://selfieconnect-backend.onrender.com`

## 📋 All Available Endpoints

### 1. **Health Check**
```
GET /
```
**Response:**
```json
{
  "status": "ok",
  "message": "Backend running 🚀"
}
```

### 2. **Test Endpoint**
```
GET /test
```
**Response:**
```
✅ test ok
```

### 3. **Debug Config**
```
GET /debug-config
```
**Response:**
```json
{
  "CONFIDENCE_THRESHOLD": 50,
  "BACKEND_BASE_URL": "https://selfieconnect-backend.onrender.com",
  "BUCKET_NAME": "selfies",
  "timestamp": "2025-01-20T10:30:00.000Z"
}
```

### 4. **Debug Routes**
```
GET /debug-routes
```
**Response:**
```json
{
  "backend": "Selfie Connect",
  "routes": [
    "GET /test",
    "POST /create-person",
    "POST /verify-upload",
    "POST /generate-qr",
    "GET /access",
    "GET /access-json",
    "GET /debug-config"
  ]
}
```

---

## 👤 Person Management

### 5. **Create Person**
```
POST /create-person
Content-Type: multipart/form-data
```

**Request Body (Form Data):**
- `userId` (string, required) - User ID
- `name` (string, optional) - Person name
- `image` (file, required) - Image file

**Response:**
```json
{
  "created": true,
  "personId": "uuid",
  "faceToken": "face_token_string"
}
```

**Error Responses:**
- `400` - Missing userId or image
- `400` - No face detected in image
- `500` - Server error

---

## 🔍 Face Verification

### 6. **Verify Upload**
```
POST /verify-upload
Content-Type: multipart/form-data
```

**Request Body (Form Data):**
- `userId` (string, required) - User ID
- `image` (file, required) - Image file to verify

**Success Response (Match Found):**
```json
{
  "success": true,
  "match": true,
  "personId": "uuid",
  "confidence": 85.5,
  "signedUrls": [
    "https://signed-url-1",
    "https://signed-url-2"
  ],
  "threshold": 50
}
```

**No Match Response:**
```json
{
  "success": false,
  "match": false,
  "reason": "below_threshold",
  "threshold": 50
}
```

**Error Responses:**
- `400` - Missing userId or image file
- `400` - No face detected in uploaded image
- `404` - No person records found for user
- `500` - Server error

---

## 📱 QR Code System

### 7. **Generate QR Code**
```
POST /generate-qr
Content-Type: application/json
```

**Request Body:**
```json
{
  "userId": "string (required)",
  "personId": "string (optional)"
}
```

**Response:**
```json
{
  "qrLink": "https://selfieconnect-backend.onrender.com/shared_view.html?token=abc123",
  "accessJsonUrl": "https://selfieconnect-backend.onrender.com/access-json?token=abc123",
  "token": "abc123",
  "expiresAt": "2025-10-20T16:52:04.43+00:00"
}
```

**Error Responses:**
- `400` - Missing userId
- `500` - Server error

### 8. **Access via QR Code**
```
GET /access?token=abc123
```

**Query Parameters:**
- `token` (string, required) - QR code token

**Success Response:**
```json
{
  "success": true,
  "sharedLink": {
    "id": "uuid",
    "owner_user_id": "uuid",
    "person_id": "uuid",
    "expires_at": "2025-10-20T16:52:04.43+00:00"
  },
  "person": {
    "id": "uuid",
    "owner_user_id": "uuid",
    "name": "Person Name",
    "face_token": "face_token_string",
    "created_at": "2025-10-11T07:32:09.352092+00:00"
  },
  "images": [
    {
      "id": "uuid",
      "url": "https://signed-url",
      "path": "users/userId/personId/filename.jpg"
    }
  ]
}
```

**Error Responses:**
- `400` - Token required
- `404` - Invalid or expired token
- `500` - Server error

---

## 🔧 Configuration

### Environment Variables Required:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
SUPABASE_BUCKET=selfies
FACE_API_KEY=your_face_api_key
FACE_API_SECRET=your_face_api_secret
PORT=5000
BACKEND_BASE_URL=https://selfieconnect-backend.onrender.com
CONFIDENCE_THRESHOLD=50
```

---

## 📊 Database Tables

### Tables Used:
1. **`persons`** - Stores person data and face tokens
2. **`images`** - Stores image metadata and paths
3. **`shared_links`** - Stores QR code tokens and expiration

### Supabase Storage:
- **Bucket**: `selfies`
- **Path Structure**: `users/{userId}/{personId}/{filename}`

---

## 🚨 Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Missing required fields |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error |

---

## 🔄 Typical Workflow

1. **Create Person**: `POST /create-person` with userId, name, and image
2. **Verify Upload**: `POST /verify-upload` to match faces
3. **Generate QR**: `POST /generate-qr` with userId and personId
4. **Access Photos**: `GET /access?token=xyz` to view shared photos

---

## 🛠️ Testing Examples

### Create Person (Postman):
```
Method: POST
URL: https://selfieconnect-backend.onrender.com/create-person
Body: form-data
- userId: "test-user-123"
- name: "John Doe"
- image: [select image file]
```

### Generate QR (Postman):
```
Method: POST
URL: https://selfieconnect-backend.onrender.com/generate-qr
Body: raw JSON
{
  "userId": "test-user-123",
  "personId": "person-uuid-here"
}
```

### Access QR Link:
```
Method: GET
URL: https://selfieconnect-backend.onrender.com/access?token=abc123
```

---

## 📝 Notes

- All image uploads use `multipart/form-data`
- Face tokens expire after 7 days (Face++ limitation)
- QR tokens expire after 1 hour
- Confidence threshold is configurable (default: 50%)
- All signed URLs expire after 5 minutes
