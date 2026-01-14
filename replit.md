# ModernChat - Real-time Chat Application

## Overview

ModernChat is a full-featured real-time messaging application built with Node.js, Express, and MongoDB. It supports one-on-one chats, group messaging, communities, voice/video calls via WebRTC, and includes AI-powered features like message moderation, auto-responses, and summarization. The application emphasizes security with quantum-safe encryption for messages and encrypted user data storage.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture
- **Framework**: Express.js server with EJS templating engine
- **Real-time Communication**: Socket.IO for bidirectional messaging and WebRTC signaling
- **Session Management**: express-session with MongoDB store (connect-mongo)
- **Authentication**: bcrypt for password hashing, session-based auth
- **File Uploads**: Multer for handling media attachments

### Database Design (MongoDB with Mongoose)
- **User**: Stores user profiles with encrypted email, profession, and location fields
- **Chat**: One-on-one messages with quantum-safe encryption, reactions, replies, self-destruct timers
- **Group**: Group metadata including admin, members, and optional community association
- **GroupChat**: Group messages with polls, reactions, and message deletion tracking
- **Community**: Discord-like communities containing multiple groups with invite codes
- **Call**: Call history tracking for audio/video calls

### Encryption Strategy
- **User Data**: AES-256-CBC encryption for sensitive fields (email, profession, location)
- **Messages**: Per-message quantum-safe keys generated using crypto.randomBytes(32), stored with each message
- **Approach**: Messages encrypted before database storage, decrypted on retrieval via model methods

### Real-time Features
- Socket.IO handles: direct messages, group messages, typing indicators, online status, WebRTC signaling
- WebRTC for peer-to-peer audio/video calls with STUN servers
- Service worker for background push notifications

### AI Integration
- **Moderation**: Local pattern-matching for profanity and toxic content detection
- **Auto-Responder**: OpenAI GPT-4 integration for smart reply suggestions (optional, falls back gracefully)
- **Summarization**: Extractive text summarization using frequency analysis (no external API required)

### Frontend Architecture
- EJS templates with Tailwind CSS styling
- Dark/light theme support with localStorage persistence
- Modular JavaScript: separate files for calls, notifications, theme, WebRTC debugging
- PWA support with service worker for offline capabilities

### Desktop Application
- Electron wrapper (main.js) spawns the Express server and loads localhost:3000
- Allows packaging as a standalone desktop application

### Authentication Flow
- SyncPilot utility generates one-time tokens for cross-device session linking
- Tokens expire after 2 minutes and are single-use

## External Dependencies

### Database
- **MongoDB**: Primary data store, connection via mongoose
- **connect-mongo**: Session persistence in MongoDB

### AI Services (Optional)
- **OpenAI API**: Used for AI auto-responder suggestions (GPT-4)
- Falls back to local pattern-based suggestions when API key unavailable

### WebRTC Infrastructure
- **Google STUN servers**: stun.l.google.com for NAT traversal in calls

### Environment Variables
- `MONGO_URI`: MongoDB connection string
- `SESSION_SECRET`: Express session secret
- `ENCRYPTION_KEY`: 32-byte key for AES encryption
- `OPENAI_API_KEY` or `AI_INTEGRATIONS_OPENAI_API_KEY`: Optional OpenAI API access
- `AI_INTEGRATIONS_OPENAI_BASE_URL`: Optional custom OpenAI endpoint

### Key NPM Packages
- express, mongoose, socket.io, bcrypt, multer
- express-session, connect-mongo
- openai (optional AI features)
- electron (desktop builds)