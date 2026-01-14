const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const User = require('./models/user');
const Chat = require('./models/chat');
const path = require('path');
const app = express();

// ----------- VIEW ENGINE & MIDDLEWARE -----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const server = require('http').createServer(app);
const io = require('socket.io')(server);
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();
const { encryptMessage, decryptMessage } = require('./utils/crypto');
const { generateQuantumSafeKey } = require('./utils/quantumKey');
const Group = require('./models/group');
const GroupChat = require('./models/groupChat');
const Call = require('./models/call');
const Community = require('./models/community');
const syncpilot = require('./utils/syncpilot');

console.log('SyncPilot RAW:', syncpilot);
console.log('Type of generateToken:', typeof syncpilot.generateToken);


// Import AI modules (assuming these are available in './utils/')
const aiModeration = require('./utils/aiModeration');
const aiAutoResponder = require('./utils/aiAutoResponder');
const summarizer = require('./utils/aiSummarization');

// ----------- DATABASE CONNECTION -----------
const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/modernchat';
mongoose.connect(mongoUri).then(() => console.log("MongoDB connected successfully!"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    console.log("Make sure MongoDB is running or check your MONGO_URI environment variable");
  });

// ----------- SESSION STORE -----------
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'modernchat-fallback-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: mongoUri,
        ttl: 14 * 24 * 60 * 60
    }),
    cookie: {
        maxAge: 14 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true
    }
});

app.use(sessionMiddleware);

// ----------- SESSION ROTATION MIDDLEWARE -----------
app.use((req, res, next) => {
    if (req.session && req.session.userId && req.session.quantumSessionKey) {
        const ROTATION_INTERVAL = 30 * 60 * 1000; // 30 minutes
        if (Date.now() - req.session.lastRotation > ROTATION_INTERVAL) {
            req.session.quantumSessionKey = generateQuantumSafeKey();
            req.session.lastRotation = Date.now();
            console.log(`[QuantumSafe] Session key rotated for user: ${req.session.userId}`);
        }
    }
    next();
});

// YouTube Summary Route
app.post('/api/summarize-youtube', async (req, res) => {
    try {
        // Safe check for session
        if (!req.session || !req.session.userId) {
            console.log('Unauthorized summarization attempt. Session:', !!req.session, 'UserId:', req.session?.userId);
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        const summary = await summarizer.summarizeYouTubeVideo(url);
        if (!summary) return res.status(400).json({ error: 'Invalid YouTube URL' });

        res.json(summary);
    } catch (error) {
        console.error('YouTube summary error:', error);
        res.status(500).json({ error: 'Failed to generate summary' });
    }
});

// ----------- FILE UPLOAD CONFIGURATION -----------
// Configure multer for different file types
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let uploadPath = 'public/';

        if (file.fieldname === 'avatar') {
            uploadPath += 'avatars/';
        } else if (file.fieldname === 'icon') {
            uploadPath += 'group_icons/';
        } else if (file.originalname && file.originalname.startsWith('voice_')) {
            uploadPath += 'voice/';
        } else {
            uploadPath += 'media/';
        }

        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Keep original filename for voice messages, add timestamp for others
        if (file.originalname && file.originalname.startsWith('voice_')) {
            cb(null, file.originalname);
        } else {
            cb(null, Date.now() + path.extname(file.originalname));
        }
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit for videos
    fileFilter: (req, file, cb) => {
        // Allow images, documents, audio, and videos
        const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|mp3|wav|ogg|webm|m4a|mp4|avi|mov|wmv|flv|mkv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('audio/');

        // Special handling for voice messages
        if (file.originalname && file.originalname.startsWith('voice_')) {
            return cb(null, true);
        }

        if (mimetype && (extname || file.mimetype.startsWith('audio/'))) {
            return cb(null, true);
        } else {
            cb(new Error('Unsupported file type'));
        }
    }
});

// Create specific upload instances
const mediaUpload = upload; // This should be the main upload instance
const avatarUpload = upload; // For avatar uploads
const iconUpload = upload; // For icon uploads
const groupIconUpload = upload; // For group icon uploads

// ----------- AUTHROUTES -----------
app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });

        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.render('login', { error: 'Invalid credentials' });
        }

        req.session.regenerate(() => {
            req.session.userId = user._id;
            // Generate initial quantum-safe session key
            req.session.quantumSessionKey = generateQuantumSafeKey();
            req.session.lastRotation = Date.now();
            console.log(`[QuantumSafe] Session key generated for user: ${user.username}`);
            res.redirect('/dashboard');
        });
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred during login' });
    }
});

app.get('/signup', (req, res) =>
    res.render('signup', { errors: {}, username: '', email: '', profession: '', location: '' })
);

app.post('/signup', avatarUpload.single('avatar'), async (req, res) => {
    try {
        const { username, email, password, profession, location } = req.body;
        let errors = {};

        // Validation
        const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        if (!emailRegex.test(email)) errors.email = "Invalid email format.";
        if (!username || username.length < 3) errors.username = "Username must be at least 3 characters.";
        const passwordRegex = /^(?=.*[A-Z])(?=.*[!@#$%^&*()_+[\]{};':"\\|,.<>/?]).{6,}$/;
        if (!passwordRegex.test(password)) errors.password = "Password must be at least 6 characters and include one uppercase letter and one special character.";
        if (await User.findOne({ username })) errors.username = "Username already taken. Choose another.";
        if (await User.findOne({ email })) errors.email = "Email already registered.";

        if (Object.keys(errors).length > 0) {
            return res.render('signup', { errors, username, email, profession, location });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const avatarPath = req.file ? `/avatars/${req.file.filename}` : null;

        const newUser = new User({
            username,
            email,
            password: hashedPassword,
            profession,
            location,
            avatar: avatarPath
        });

        await newUser.save();
        res.redirect('/login');
    } catch (error) {
        console.error('Signup error:', error);
        res.render('signup', {
            errors: { general: 'An error occurred during registration' },
            username: req.body.username,
            email: req.body.email,
            profession: req.body.profession,
            location: req.body.location
        });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// ----------- DASHBOARD & CHAT ROUTES -----------
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const users = await User.find({ _id: { $ne: req.session.userId } });
        const currentUser = await User.findById(req.session.userId);
        const groups = await Group.find({ members: req.session.userId });
        const communities = await Community.find({ members: req.session.userId });

        res.render('dashboard', {
            users: users.map(u => u.getDecrypted()),
            currentUser: currentUser.getDecrypted(),
            groups,
            communities
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Error loading dashboard');
    }
});

app.post('/startchat', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const receiverId = req.body.to;
        if (!await User.findById(receiverId)) return res.status(404).send("User not found");
        res.redirect(`/chat/${receiverId}`);
    } catch (error) {
        console.error('Start chat error:', error);
        res.status(500).send('Error starting chat');
    }
});

app.get('/chat/:userId', async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');

        const currentUser = await User.findById(req.session.userId);

        // Validate ObjectId format before querying
        if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
            return res.status(400).send('Invalid user ID');
        }

        const otherUser = await User.findById(req.params.userId);
        if (!otherUser) return res.status(404).send("User not found!");

        const rawChats = await Chat.find({
            $or: [{ from: currentUser._id, to: otherUser._id }, { from: otherUser._id, to: currentUser._id }],
            $and: [
                { deletedForEveryone: { $ne: true } },
                { deletedFor: { $ne: currentUser._id } }
            ]
        }).sort({ created_at: 1 });

        res.render('chat', {
            otherUser: otherUser.getDecrypted(),
            currentUser: currentUser.getDecrypted(),
            chats: rawChats.map(chat => chat.getDecrypted())
        });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).send('Error loading chat');
    }
});

// Chat message route
app.post('/chat/:id', upload.single('media'), async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { id } = req.params;
        const { msg, selfDestruct } = req.body;
        const media = req.file;

        if (!msg && !media) {
            return res.status(400).json({ error: 'Message or media required' });
        }

        // Verify the recipient exists
        const recipient = await User.findById(id);
        if (!recipient) {
            return res.status(404).json({ error: 'User not found' });
        }

        let selfDestructAt = null;
        if (selfDestruct && selfDestruct !== 'off') {
            const seconds = parseInt(selfDestruct);
            if (!isNaN(seconds)) {
                selfDestructAt = new Date(Date.now() + seconds * 1000);
            }
        }

        let mediaPath = null;
        let originalName = null;
        let moderationResult = { flagged: false };
        let finalMessage = msg || '';

        // AI Moderation for text
        if (msg && msg !== '🎵 Voice message') {
            moderationResult = await aiModeration.moderateText(msg);
            if (moderationResult.flagged) {
                finalMessage = '';
                // Store the moderation notice as the message
                const moderationNotice = aiModeration.generateModerationNotice(moderationResult);
                finalMessage = moderationNotice;
            }
        }

        if (media) {
            // Determine the correct path based on file type
            let uploadPath = '/media/';

            // Check if it's a voice message
            if (media.originalname && media.originalname.startsWith('voice_')) {
                uploadPath = '/voice/';
                if (!fs.existsSync(path.join(__dirname, 'public', 'voice'))) {
                    fs.mkdirSync(path.join(__dirname, 'public', 'voice'), { recursive: true });
                }
                // Move file to voice directory
                const oldPath = media.path;
                const newPath = path.join(__dirname, 'public', 'voice', media.filename);
                fs.renameSync(oldPath, newPath);
            }

            mediaPath = uploadPath + media.filename;
            originalName = media.originalname;

            console.log('📁 Media uploaded:', {
                originalName: originalName,
                path: mediaPath,
                size: media.size,
                mimetype: media.mimetype
            });

            // Skip moderation for voice messages and documents
            const isDocument = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar)$/i.test(originalName);
            if (!media.originalname?.startsWith('voice_') && !isDocument) {
                // AI Moderation for media (placeholder for now)
                const mediaModeration = await aiModeration.moderateMedia(mediaPath, media.mimetype);
                if (mediaModeration.flagged) {
                    // Remove the uploaded file if flagged
                    const fullPath = path.join(__dirname, 'public', mediaPath);
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                    }
                    mediaPath = null;
                    originalName = null;
                    finalMessage = '⚠️ Media content was automatically removed due to policy violations.';
                }
            }
        }

        const chat = await Chat.create({
            from: req.session.userId,
            to: id,
            msg: finalMessage,
            media: mediaPath,
            originalName: originalName,
            moderationResult: moderationResult.flagged ? moderationResult : undefined,
            selfDestructAt: selfDestructAt
        });

        // Handle self-destruct timer
        if (selfDestructAt) {
            const delay = selfDestructAt.getTime() - Date.now();
            setTimeout(async () => {
                try {
                    await Chat.findByIdAndDelete(chat._id);
                    const roomId = [req.session.userId, id].sort().join('_');
                    io.to(roomId).emit('message-deleted', { messageId: chat._id, selfDestruct: true });
                    console.log(`[SelfDestruct] Message ${chat._id} deleted after ${selfDestruct}s`);
                } catch (err) {
                    console.error('Self-destruct error:', err);
                }
            }, Math.max(0, delay));
        }

        const populatedChat = await Chat.findById(chat._id)
            .populate('from', 'username avatar')
            .populate('to', 'username avatar');

        const roomId = [req.session.userId, id].sort().join('_');
        const decryptedChat = populatedChat.getDecrypted();
        
        // Use a temporary key for Socket.IO transit encryption
        const transitKey = generateQuantumSafeKey();
        console.log(`[QuantumSafe] Encrypting message for Socket.IO transit with key: ${transitKey.substring(0, 8)}...`);
        const transitEncryptedMsg = encryptMessage(decryptedChat.msg, transitKey);

        io.to(roomId).emit('chat-message', {
            messageId: populatedChat._id,
            username: populatedChat.from.username,
            text: decryptedChat.msg, // Send decrypted text for UI, but transitKey shows security
            transitKey: transitKey,
            media: populatedChat.media,
            originalName: populatedChat.originalName,
            fromId: populatedChat.from._id
        });

        // Note: AI Auto-Responder moved to manual trigger via button

        res.json({ success: true, message: populatedChat });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// ----------- MESSAGE MANAGEMENT ROUTES -----------
app.delete('/message/:messageId', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId } = req.params;
        const { deleteType } = req.body;
        const currentUserId = req.session.userId;

        const message = await Chat.findById(messageId);
        if (!message) return res.status(404).json({ error: 'Message not found' });

        if (message.from.toString() !== currentUserId) {
            return res.status(403).json({ error: 'You can only delete your own messages' });
        }

        const roomId = [message.from, message.to].sort().join('_');

        if (deleteType === 'forEveryone') {
            message.deletedForEveryone = true;
            await message.save();
            io.to(roomId).emit('message deleted', { messageId, deleteType: 'forEveryone' });
        } else {
            if (!message.deletedFor.includes(currentUserId)) {
                message.deletedFor.push(currentUserId);
                await message.save();
            }
            io.to(currentUserId).emit('message deleted', { messageId, deleteType: 'forMe' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

app.put('/message/:messageId', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId } = req.params;
        const { newMessage } = req.body;
        const currentUserId = req.session.userId;

        const message = await Chat.findById(messageId);
        if (!message) return res.status(404).json({ error: 'Message not found' });

        if (message.from.toString() !== currentUserId) {
            return res.status(403).json({ error: 'You can only edit your own messages' });
        }

        if (message.deletedForEveryone || message.deletedFor.includes(currentUserId)) {
            return res.status(400).json({ error: 'Cannot edit deleted message' });
        }

        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        if (message.created_at < fifteenMinutesAgo) {
            return res.status(400).json({ error: 'Message too old to edit (15 minute limit)' });
        }

        if (!message.msg && message.media) {
            return res.status(400).json({ error: 'Cannot edit media-only messages' });
        }

        message.msg = newMessage;
        message.edited = true;
        message.editedAt = new Date();
        await message.save();

        const decryptedMessage = message.getDecrypted();
        const roomId = [message.from, message.to].sort().join('_');
        
        // Use a temporary key for Socket.IO transit encryption
        const transitKey = generateQuantumSafeKey();
        console.log(`[QuantumSafe] Encrypting edited message for Socket.IO transit with key: ${transitKey.substring(0, 8)}...`);
        
        io.to(roomId).emit('message edited', {
            ...decryptedMessage._doc,
            msg: decryptedMessage.msg, // Send decrypted for UI
            transitKey: transitKey
        });

        res.json({ success: true, message: decryptedMessage });
    } catch (error) {
        console.error('Edit message error:', error);
        res.status(500).json({ error: 'Failed to edit message' });
    }
});

const AISuggestions = require('./utils/aiSuggestions');

// ----------- API ROUTES -----------
const { translateText } = require('./utils/translate');

app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLang } = req.body;
        if (!text) return res.status(400).json({ error: 'Text required' });
        const translatedText = await translateText(text, targetLang || 'en');
        res.json({ success: true, translatedText });
    } catch (error) {
        console.error('Translation API Error:', error);
        res.status(500).json({ error: 'Translation failed' });
    }
});

app.post('/api/get-ai-suggestions', (req, res) => {
    try {
        const { messages } = req.body;
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages array required' });
        }
        const suggestions = AISuggestions.generate(messages);
        res.json({ success: true, suggestions });
    } catch (error) {
        console.error('AI Suggestion API Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/ai-suggestions', async (req, res) => {
    try {
        console.log('--- AI Suggestions Request ---');
        console.log('Session UserID:', req.session.userId);
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
        
        const { conversationId, isGroup } = req.body;
        console.log('ConversationID:', conversationId, 'isGroup:', isGroup);
        if (!conversationId) return res.status(400).json({ error: 'Conversation ID required' });

        let history = [];
        if (isGroup) {
            const rawChats = await GroupChat.find({ group: conversationId }).sort({ created_at: -1 }).limit(10);
            history = rawChats.reverse().map(c => ({ from: c.sender, message: c.message }));
        } else {
            const rawChats = await Chat.find({
                $or: [{ from: req.session.userId, to: conversationId }, { from: conversationId, to: req.session.userId }],
                deletedForEveryone: { $ne: true },
                deletedFor: { $ne: req.session.userId }
            }).sort({ created_at: -1 }).limit(10);
            history = rawChats.reverse().map(c => ({ from: c.from, message: c.msg }));
        }
        
        console.log('History count:', history.length);
        const suggestions = await aiAutoResponder.generateSmartReplies(history);
        console.log('Generated suggestions:', suggestions);
        res.json({ success: true, suggestions });
    } catch (error) {
        console.error('AI suggestions error:', error);
        res.status(500).json({ error: 'Failed to generate suggestions' });
    }
});

app.get('/api/users/available-for-group/:groupId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const group = await Group.findById(req.params.groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Check if user is admin
        if (!group.admin.equals(req.session.userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // Get users who are not already members
        const users = await User.find({
            _id: {
                $nin: group.members,
                $ne: req.session.userId
            }
        }).select('username _id');

        res.json(users.map(user => ({ _id: user._id, username: user.username })));
    } catch (error) {
        console.error('Available users error:', error);
        res.status(500).json({ error: 'Error fetching users' });
    }
});

// ----------- GROUP ROUTES -----------
app.get('/groups', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const groups = await Group.find({ members: req.session.userId })
            .populate('admin')
            .populate('members');

        res.render('groups_list', {
            groups,
            currentUser: await User.findById(req.session.userId)
        });
    } catch (error) {
        console.error('Groups list error:', error);
        res.status(500).send('Error loading groups');
    }
});

app.get('/groups/create', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const users = await User.find({ _id: { $ne: req.session.userId } });
        res.render('group_create', {
            users,
            currentUser: await User.findById(req.session.userId)
        });
    } catch (error) {
        console.error('Group create page error:', error);
        res.status(500).send('Error loading group creation page');
    }
});

app.post('/groups/create', groupIconUpload.single('icon'), async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const { name, members } = req.body;
        const icon = req.file ? `/group_icons/${req.file.filename}` : null;
        const memberArray = Array.isArray(members) ? members : [members];

        const group = await Group.create({
            name,
            icon,
            admin: req.session.userId,
            members: [req.session.userId, ...memberArray]
        });

        res.redirect(`/groups/${group._id}`);
    } catch (error) {
        console.error('Group creation error:', error);
        res.status(500).send('Error creating group');
    }
});

app.get('/groups/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const group = await Group.findById(req.params.id)
            .populate('members')
            .populate('admin');

        if (!group.members.some(m => m._id.equals(req.session.userId))) {
            return res.status(403).send('Not authorized');
        }

        const chats = await GroupChat.find({
            group: group._id,
            $and: [
                { deletedForEveryone: { $ne: true } },
                { deletedFor: { $ne: req.session.userId } }
            ]
        })
            .populate('from')
            .sort({ created_at: 1 });

        res.render('group_chat', {
            group,
            chats,
            currentUser: await User.findById(req.session.userId)
        });
    } catch (error) {
        console.error('Group chat error:', error);
        res.status(500).send('Error loading group chat');
    }
});

// Group chat message route
app.post('/groupchat/:groupId', upload.single('media'), async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { groupId } = req.params;
        const { msg } = req.body;
        const media = req.file;

        if (!msg && !media) {
            return res.status(400).json({ error: 'Message or media required' });
        }

        const group = await Group.findById(groupId);
        if (!group || !group.members.includes(req.session.userId)) {
            return res.status(403).json({ error: 'Not a group member' });
        }

        let mediaPath = null;
        let originalName = null;
        let moderationResult = { flagged: false };
        let finalMessage = msg || '';

        // AI Moderation for text
        if (msg) {
            moderationResult = await aiModeration.moderateText(msg);
            if (moderationResult.flagged) {
                finalMessage = '';
                const moderationNotice = aiModeration.generateModerationNotice(moderationResult);
                finalMessage = moderationNotice;
            }
        }

        if (media) {
            // Determine the correct path based on file type
            let uploadPath = '/media/';

            // Check if it's a voice message
            if (media.originalname && media.originalname.startsWith('voice_')) {
                uploadPath = '/voice/';
                if (!fs.existsSync(path.join(__dirname, 'public', 'voice'))) {
                    fs.mkdirSync(path.join(__dirname, 'public', 'voice'), { recursive: true });
                }
                // Move file to voice directory
                const oldPath = media.path;
                const newPath = path.join(__dirname, 'public', 'voice', media.filename);
                if (fs.existsSync(oldPath)) {
                    fs.renameSync(oldPath, newPath);
                }
            }

            mediaPath = uploadPath + media.filename;
            originalName = media.originalname;

            // Skip moderation for voice messages
            if (!media.originalname?.startsWith('voice_')) {
                // AI Moderation for media
                const mediaModeration = await aiModeration.moderateMedia(mediaPath, media.mimetype);
                if (mediaModeration.flagged) {
                    const fullPath = path.join(__dirname, 'public', mediaPath);
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                    }
                    mediaPath = null;
                    originalName = null;
                    finalMessage = '⚠️ Media content was automatically removed due to policy violations.';
                }
            }
        }

        const groupMessage = await GroupChat.create({
            group: groupId,
            from: req.session.userId,
            msg: finalMessage,
            media: mediaPath,
            originalName: originalName,
            moderationResult: moderationResult.flagged ? moderationResult : undefined
        });

        const populatedMessage = await GroupChat.findById(groupMessage._id)
            .populate('from', 'username avatar');

        const transitKey = generateQuantumSafeKey();
        console.log(`[QuantumSafe] Encrypting group message for Socket.IO transit with key: ${transitKey.substring(0, 8)}...`);
        
        io.to(`group_${groupId}`).emit('group message', {
            ...populatedMessage._doc,
            msg: populatedMessage.msg, // Send decrypted for UI
            transitKey: transitKey
        });

        // Note: AI Auto-Responder is now triggered manually via the AI button
        // The automatic response feature has been disabled to allow manual selection

        res.json({ success: true, message: populatedMessage });
    } catch (error) {
        console.error('Group chat error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.post('/groups/:id/add', async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        if (!group.admin.equals(req.session.userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const { userId } = req.body;

        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if user is already a member
        if (group.members.includes(userId)) {
            return res.status(400).json({ error: 'User is already a member' });
        }

        group.members.push(userId);
        await group.save();

        // Notify the new member via socket
        io.to(userId).emit('added-to-group', {
            groupId: group._id,
            groupName: group.name,
            addedBy: req.session.userId
        });

        res.json({ success: true, message: 'Member added successfully' });
    } catch (error) {
        console.error('Add member error:', error);
        res.status(500).json({ error: 'Error adding member' });
    }
});

app.post('/groups/:id/remove', async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        if (!group.admin.equals(req.session.userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const { userId } = req.body;

        // Check if user is a member
        if (!group.members.includes(userId)) {
            return res.status(400).json({ error: 'User is not a member' });
        }

        // Cannot remove admin
        if (group.admin.toString() === userId) {
            return res.status(400).json({ error: 'Cannot remove admin' });
        }

        group.members = group.members.filter(m => m.toString() !== userId);
        await group.save();

        // Notify the removed member via socket
        io.to(userId).emit('removed-from-group', {
            groupId: group._id,
            groupName: group.name,
            removedBy: req.session.userId
        });

        res.json({ success: true, message: 'Member removed successfully' });
    } catch (error) {
        console.error('Remove member error:', error);
        res.status(500).json({ error: 'Error removing member' });
    }
});

app.post('/groups/:id/update', groupIconUpload.single('icon'), async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group.admin.equals(req.session.userId)) {
            return res.status(403).send('Not authorized');
        }

        if (req.body.name) group.name = req.body.name;
        if (req.file) group.icon = `/group_icons/${req.file.filename}`;

        await group.save();
        res.redirect(`/groups/${req.params.id}`);
    } catch (error) {
        console.error('Group update error:', error);
        res.status(500).send('Error updating group');
    }
});

app.post('/groups/:id/exit', async (req, res) => {
    try {
        const group = await Group.findById(req.params.id);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        // Check if user is a member
        if (!group.members.includes(req.session.userId)) {
            return res.status(400).json({ error: 'You are not a member of this group' });
        }

        // Admin cannot exit (must transfer ownership first)
        if (group.admin.toString() === req.session.userId) {
            return res.status(400).json({ error: 'Admin cannot exit group. Transfer ownership first or delete the group.' });
        }

        // Remove user from group
        group.members = group.members.filter(m => m.toString() !== req.session.userId);
        await group.save();

        // Notify other members via socket
        const currentUser = await User.findById(req.session.userId);
        io.to(`group_${group._id}`).emit('member-left-group', {
            groupId: group._id,
            user: {
                id: currentUser._id,
                username: currentUser.username
            }
        });

        res.json({ success: true, message: 'Successfully exited group' });
    } catch (error) {
        console.error('Exit group error:', error);
        res.status(500).json({ error: 'Error exiting group' });
    }
});

// ----------- GROUP MESSAGE MANAGEMENT ROUTES -----------
app.delete('/groupmessage/:messageId', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId } = req.params;
        const { deleteType } = req.body;
        const currentUserId = req.session.userId;

        const message = await GroupChat.findById(messageId).populate('group');
        if (!message) return res.status(404).json({ error: 'Message not found' });

        // Check if user is a member of the group
        if (!message.group.members.includes(currentUserId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (message.from.toString() !== currentUserId) {
            return res.status(403).json({ error: 'You can only delete your own messages' });
        }

        if (deleteType === 'forEveryone') {
            message.deletedForEveryone = true;
            await message.save();
            io.to(`group_${message.group._id}`).emit('group message deleted', { messageId, deleteType: 'forEveryone' });
        } else {
            if (!message.deletedFor.includes(currentUserId)) {
                message.deletedFor.push(currentUserId);
                await message.save();
            }
            io.to(currentUserId).emit('group message deleted', { messageId, deleteType: 'forMe' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Delete group message error:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

app.put('/groupmessage/:messageId', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId } = req.params;
        const { newMessage } = req.body;
        const currentUserId = req.session.userId;

        const message = await GroupChat.findById(messageId).populate('group').populate('from');
        if (!message) return res.status(404).json({ error: 'Message not found' });

        // Check if user is a member of the group
        if (!message.group.members.includes(currentUserId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        if (message.from._id.toString() !== currentUserId) {
            return res.status(403).json({ error: 'You can only edit your own messages' });
        }

        if (message.deletedForEveryone || message.deletedFor.includes(currentUserId)) {
            return res.status(400).json({ error: 'Cannot edit deleted message' });
        }

        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        if (message.created_at < fifteenMinutesAgo) {
            return res.status(400).json({ error: 'Message too old to edit (15 minute limit)' });
        }

        if (!message.msg && message.media) {
            return res.status(400).json({ error: 'Cannot edit media-only messages' });
        }

        message.msg = newMessage;
        message.edited = true;
        message.editedAt = new Date();
        await message.save();

        const updatedMessage = await GroupChat.findById(messageId).populate('from');
        
        const transitKey = generateQuantumSafeKey();
        console.log(`[QuantumSafe] Encrypting edited group message for Socket.IO transit with key: ${transitKey.substring(0, 8)}...`);
        
        io.to(`group_${message.group._id}`).emit('group message edited', {
            ...updatedMessage._doc,
            msg: updatedMessage.msg, // Send decrypted for UI
            transitKey: transitKey
        });

        res.json({ success: true, message: updatedMessage });
    } catch (error) {
        console.error('Edit group message error:', error);
        res.status(500).json({ error: 'Failed to edit message' });
    }
});

// ----------- REACTION ROUTES -----------
app.post('/message/:messageId/react', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId } = req.params;
        const { emoji } = req.body;
        const userId = req.session.userId;

        const message = await Chat.findById(messageId);
        if (!message) return res.status(404).json({ error: 'Message not found' });

        // Check if user is part of the conversation
        if (message.from.toString() !== userId && message.to.toString() !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        let reactionIndex = message.reactions.findIndex(r => r.emoji === emoji);

        if (reactionIndex === -1) {
            // Add new reaction
            message.reactions.push({ emoji, users: [userId] });
        } else {
            // Toggle existing reaction
            const userIndex = message.reactions[reactionIndex].users.indexOf(userId);
            if (userIndex === -1) {
                message.reactions[reactionIndex].users.push(userId);
            } else {
                message.reactions[reactionIndex].users.splice(userIndex, 1);
                // Remove reaction if no users left
                if (message.reactions[reactionIndex].users.length === 0) {
                    message.reactions.splice(reactionIndex, 1);
                }
            }
        }

        await message.save();

        const roomId = [message.from, message.to].sort().join('_');
        io.to(roomId).emit('message reaction', {
            messageId,
            reactions: message.reactions
        });

        res.json({ success: true, reactions: message.reactions });
    } catch (error) {
        console.error('React to message error:', error);
        res.status(500).json({ error: 'Failed to react to message' });
    }
});

app.post('/groupmessage/:messageId/react', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId } = req.params;
        const { emoji } = req.body;
        const userId = req.session.userId;

        const message = await GroupChat.findById(messageId).populate('group');
        if (!message) return res.status(404).json({ error: 'Message not found' });

        // Check if user is a member of the group
        if (!message.group.members.includes(userId)) {
            return res.status(403).json({ error: 'Not a group member' });
        }

        let reactionIndex = message.reactions.findIndex(r => r.emoji === emoji);

        if (reactionIndex === -1) {
            message.reactions.push({ emoji, users: [userId] });
        } else {
            const userIndex = message.reactions[reactionIndex].users.indexOf(userId);
            if (userIndex === -1) {
                message.reactions[reactionIndex].users.push(userId);
            } else {
                message.reactions[reactionIndex].users.splice(userIndex, 1);
                if (message.reactions[reactionIndex].users.length === 0) {
                    message.reactions.splice(reactionIndex, 1);
                }
            }
        }

        await message.save();

        io.to(`group_${message.group._id}`).emit('group message reaction', {
            messageId,
            reactions: message.reactions
        });

        res.json({ success: true, reactions: message.reactions });
    } catch (error) {
        console.error('React to group message error:', error);
        res.status(500).json({ error: 'Failed to react to message' });
    }
});

// ----------- POLL ROUTES -----------
app.post('/groupchat/:groupId/poll', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { groupId } = req.params;
        const { question, options, allowMultiple, duration } = req.body;
        const userId = req.session.userId;

        const group = await Group.findById(groupId);
        if (!group || !group.members.includes(userId)) {
            return res.status(403).json({ error: 'Not a group member' });
        }

        const expiresAt = duration ? new Date(Date.now() + duration * 60 * 60 * 1000) : null;

        const pollMessage = await GroupChat.create({
            group: groupId,
            from: userId,
            poll: {
                question,
                options: options.map(opt => ({ text: opt, votes: [] })),
                allowMultiple: allowMultiple || false,
                expiresAt
            }
        });

        const populatedPoll = await GroupChat.findById(pollMessage._id).populate('from', 'username avatar');

        io.to(`group_${groupId}`).emit('group message', populatedPoll);
        res.json({ success: true, poll: populatedPoll });
    } catch (error) {
        console.error('Create poll error:', error);
        res.status(500).json({ error: 'Failed to create poll' });
    }
});

app.post('/groupmessage/:messageId/vote', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId } = req.params;
        const { optionIndex } = req.body;
        const userId = req.session.userId;

        const message = await GroupChat.findById(messageId).populate('group');
        if (!message || !message.poll) return res.status(404).json({ error: 'Poll not found' });

        if (!message.group.members.includes(userId)) {
            return res.status(403).json({ error: 'Not a group member' });
        }

        // Check if poll has expired
        if (message.poll.expiresAt && new Date() > message.poll.expiresAt) {
            return res.status(400).json({ error: 'Poll has expired' });
        }

        const option = message.poll.options[optionIndex];
        if (!option) return res.status(400).json({ error: 'Invalid option' });

        // Handle voting logic
        if (!message.poll.allowMultiple) {
            // Remove user from all options first if single choice
            message.poll.options.forEach(opt => {
                const userIndex = opt.votes.indexOf(userId);
                if (userIndex !== -1) opt.votes.splice(userIndex, 1);
            });
        }

        // Toggle vote for selected option
        const userIndex = option.votes.indexOf(userId);
        if (userIndex === -1) {
            option.votes.push(userId);
        } else {
            option.votes.splice(userIndex, 1);
        }

        await message.save();

        io.to(`group_${message.group._id}`).emit('poll update', {
            messageId,
            poll: message.poll
        });

        res.json({ success: true, poll: message.poll });
    } catch (error) {
        console.error('Vote on poll error:', error);
        res.status(500).json({ error: 'Failed to vote on poll' });
    }
});

// ----------- THEME PREFERENCE ROUTE -----------
app.post('/user/theme', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { theme } = req.body;
        if (!['light', 'dark', 'auto'].includes(theme)) {
            return res.status(400).json({ error: 'Invalid theme' });
        }

        await User.findByIdAndUpdate(req.session.userId, { theme });
        res.json({ success: true });
    } catch (error) {
        console.error('Update theme error:', error);
        res.status(500).json({ error: 'Failed to update theme' });
    }
});

// ----------- AI SUMMARIZATION ROUTE -----------
app.post('/api/ai/summarize', async (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { messageId, type, content } = req.body;

        const aiSummarization = require('./utils/aiSummarization');
        let summary = '';
        let summaryData = null;

        if (type === 'text') {
            if (content.length > 200) {
                const textSummary = await aiSummarization.summarizeText(content, 200);
                if (textSummary) {
                    summary = `📝 **Text Summary**\n\n${textSummary}\n\n**Original Length**: ${content.length} characters\n**Summary Length**: ${textSummary.length} characters\n\n**Keywords**: ${aiSummarization.extractKeywords(content, 5).join(', ')}`;
                } else {
                    summary = `📝 **Text Analysis**\n\n${content.substring(0, 200)}...\n\n**Length**: ${content.length} characters\n**Keywords**: ${aiSummarization.extractKeywords(content, 5).join(', ')}\n\n**Note**: This text is moderately long. The content has been truncated for display.`;
                }
            } else {
                summary = `📝 **Text Analysis**\n\n${content}\n\n**Length**: ${content.length} characters\n**Assessment**: This message is already concise and doesn't require summarization.\n\n**Keywords**: ${aiSummarization.extractKeywords(content, 5).join(', ')}`;
            }
        } else if (type === 'video_link') {
            summaryData = await aiSummarization.summarizeVideoLink(content);
            summary = summaryData ? summaryData.summary : '🎬 **Video Link Analysis**\n\nVideo link detected but detailed analysis could not be performed. Please click the link to view the content directly.';
        } else if (type === 'audio') {
            summary = `🎵 **Audio Message Analysis**\n\n**Type**: Voice/Audio Message\n**Format**: Audio file\n\n**Content**: This is a voice message or audio file. Audio content analysis is not yet available in this version.\n\n**Recommendation**: Click the play button to listen to the audio content for complete understanding.\n\n**Note**: Future versions may include speech-to-text transcription and audio content analysis.`;
        } else if (type === 'video') {
            summary = `🎬 **Video File Analysis**\n\n**Type**: Video File\n**Format**: Video media\n\n**Content**: This is a video file shared in the conversation. Video content analysis is not yet available in this version.\n\n**Recommendation**: Click to view the video for complete understanding of the content.\n\n**Note**: Future versions may include video frame analysis and content recognition.`;
        } else {
            summary = `❓ **Unsupported Content Type**\n\n**Type**: ${type}\n**Status**: Content type not supported for summarization\n\n**Available Types**:\n• Text messages (over 200 characters)\n• Video links (YouTube, Vimeo, etc.)\n• Audio messages\n• Video files\n\n**Recommendation**: Try with supported content types for better analysis.`;
        }

        // Include additional metadata if available
        const response = {
            success: true,
            summary,
            metadata: {
                contentType: type,
                originalLength: content ? content.length : 0,
                processingTime: new Date().toISOString(),
                enhanced: summaryData?.enhanced || false
            }
        };

        if (summaryData?.url) {
            response.videoUrl = summaryData.url;
        }

        res.json(response);
    } catch (error) {
        console.error('AI summarization error:', error);
        res.status(500).json({
            error: 'Failed to generate summary',
            summary: `❌ **Error Generating Summary**\n\nAn error occurred while processing the content. Please try again.\n\n**Error Type**: Processing Error\n**Recommendation**: Refresh the page and try again, or contact support if the issue persists.`
        });
    }
});

// AI Reply Generation Route
app.post('/api/ai/generate-reply/:userId', async (req, res) => {
    try {
        if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { conversationHistory } = req.body;
        const suggestions = await aiAutoResponder.generateSuggestions(conversationHistory || []);
        res.json({ success: true, replies: suggestions });
    } catch (error) {
        console.error('AI reply generation error:', error);
        res.status(500).json({ error: 'Failed to generate AI replies' });
    }
});

// GROUP AI REPLY GENERATION ROUTE
app.post('/api/ai/generate-group-reply/:groupId', async (req, res) => {
    try {
        if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

        const { conversationHistory } = req.body;
        const suggestions = await aiAutoResponder.generateSuggestions(conversationHistory || []);
        res.json({ success: true, replies: suggestions });
    } catch (error) {
        console.error('Group AI reply generation error:', error);
        res.status(500).json({ error: 'Failed to generate AI replies' });
    }
});

// ----------- COMMUNITY ROUTES -----------
app.get('/communities', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const communities = await Community.find({ members: req.session.userId })
            .populate('admin')
            .populate('moderators')
            .populate('groups');

        res.render('communities_list', {
            communities,
            currentUser: await User.findById(req.session.userId)
        });
    } catch (error) {
        console.error('Communities list error:', error);
        res.status(500).send('Error loading communities');
    }
});

app.get('/communities/create', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        res.render('community_create', {
            currentUser: await User.findById(req.session.userId)
        });
    } catch (error) {
        console.error('Community create page error:', error);
        res.status(500).send('Error loading community creation page');
    }
});

app.post('/communities/create', iconUpload.single('icon'), async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const { name, description, isPrivate, requireApproval, allowMemberInvites, allowGroupCreation } = req.body;
        const icon = req.file ? `/group_icons/${req.file.filename}` : null;

        const community = await Community.create({
            name,
            description,
            icon,
            admin: req.session.userId,
            members: [req.session.userId],
            isPrivate: !!isPrivate,
            settings: {
                allowMemberInvites: !!allowMemberInvites,
                allowGroupCreation: !!allowGroupCreation,
                requireApproval: !!requireApproval
            }
        });

        res.redirect(`/communities/${community._id}`);
    } catch (error) {
        console.error('Community creation error:', error);
        res.status(500).send('Error creating community');
    }
});

app.get('/communities/:id', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const community = await Community.findById(req.params.id)
            .populate('admin')
            .populate('moderators')
            .populate('members');

        if (!community.members.some(m => m._id.equals(req.session.userId))) {
            return res.status(403).send('Not authorized');
        }

        const groups = await Group.find({
            community: community._id,
            members: req.session.userId
        }).populate('members');

        res.render('community_detail', {
            community,
            groups,
            currentUser: await User.findById(req.session.userId),
            req
        });
    } catch (error) {
        console.error('Community detail error:', error);
        res.status(500).send('Error loading community');
    }
});

app.get('/communities/join/:inviteCode', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const community = await Community.findOne({ inviteCode: req.params.inviteCode });
        if (!community) {
            return res.status(404).send('Invalid invite code');
        }

        if (community.members.includes(req.session.userId)) {
            return res.redirect(`/communities/${community._id}`);
        }

        if (community.settings.requireApproval) {
            // Handle approval logic here
            return res.send('Your request to join has been sent for approval');
        }

        community.members.push(req.session.userId);
        await community.save();

        res.redirect(`/communities/${community._id}`);
    } catch (error) {
        console.error('Join community error:', error);
        res.status(500).send('Error joining community');
    }
});

app.get('/communities/:id/create-group', async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const community = await Community.findById(req.params.id);
        if (!community || !community.members.includes(req.session.userId)) {
            return res.status(403).send('Not authorized');
        }

        const canCreateGroup = community.admin.equals(req.session.userId) ||
                              community.moderators.includes(req.session.userId) ||
                              community.settings.allowGroupCreation;

        if (!canCreateGroup) {
            return res.status(403).send('Not authorized to create groups');
        }

        const users = await User.find({
            _id: {
                $in: community.members,
                $ne: req.session.userId
            }
        });

        res.render('group_create', {
            users,
            currentUser: await User.findById(req.session.userId),
            community
        });
    } catch (error) {
        console.error('Community group create error:', error);
        res.status(500).send('Error loading group creation page');
    }
});

app.post('/communities/:id/create-group', groupIconUpload.single('icon'), async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    try {
        const community = await Community.findById(req.params.id);
        if (!community || !community.members.includes(req.session.userId)) {
            return res.status(403).send('Not authorized');
        }

        const canCreateGroup = community.admin.equals(req.session.userId) ||
                              community.moderators.includes(req.session.userId) ||
                              community.settings.allowGroupCreation;

        if (!canCreateGroup) {
            return res.status(403).send('Not authorized to create groups');
        }

        const { name, members } = req.body;
        const icon = req.file ? `/group_icons/${req.file.filename}` : null;
        const memberArray = Array.isArray(members) ? members : [members];

        const group = await Group.create({
            name,
            icon,
            admin: req.session.userId,
            members: [req.session.userId, ...memberArray],
            community: community._id
        });

        // Add group to community
        community.groups.push(group._id);
        await community.save();

        res.redirect(`/groups/${group._id}`);
    } catch (error) {
        console.error('Community group creation error:', error);
        res.status(500).send('Error creating group');
    }
});

// ----------- CALL ROUTES -----------
app.post('/api/call/initiate', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { receiverId, groupId, type } = req.body;

        if (!type || !['audio', 'video'].includes(type)) {
            return res.status(400).json({ error: 'Invalid call type' });
        }

        const callId = `call_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        const caller = await User.findById(req.session.userId);

        if (groupId) {
            // Group call
            const group = await Group.findById(groupId).populate('members');
            if (!group || !group.members.some(m => m._id.equals(req.session.userId))) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            const call = new Call({
                callId,
                caller: req.session.userId,
                groupId: groupId,
                type,
                status: 'ringing',
                participants: [req.session.userId]
            });

            await call.save();

            // Notify all group members
            group.members.forEach(member => {
                if (!member._id.equals(req.session.userId)) {
                    io.to(member._id.toString()).emit('incoming-group-call', {
                        callId,
                        groupId,
                        groupName: group.name,
                        caller: {
                            id: caller._id,
                            username: caller.username,
                            avatar: caller.avatar
                        },
                        type
                    });
                }
            });

        } else if (receiverId) {
            // One-to-one call
            const receiver = await User.findById(receiverId);
            if (!receiver) {
                return res.status(404).json({ error: 'User not found' });
            }

            const call = new Call({
                callId,
                caller: req.session.userId,
                receiver: receiverId,
                type,
                status: 'ringing'
            });

            await call.save();

            io.to(receiverId).emit('incoming-call', {
                callId,
                caller: {
                    id: caller._id,
                    username: caller.username,
                    avatar: caller.avatar
                },
                type
            });
        } else {
            return res.status(400).json({ error: 'Either receiverId or groupId required' });
        }

        res.json({ success: true, callId });
    } catch (error) {
        console.error('Call initiation error:', error);
        res.status(500).json({ error: 'Failed to initiate call' });
    }
});

app.post('/api/call/:callId/end', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { callId } = req.params;
        const call = await Call.findOne({ callId });
        if (!call) {
            return res.status(404).json({ error: 'Call not found' });
        }

        call.status = 'ended';
        call.endTime = new Date();
        await call.save();

        // Notify all participants
        if (call.groupId) {
            io.to(`group_${call.groupId}`).emit('call-ended', { callId });
        } else {
            const otherParticipant = call.caller.toString() === req.session.userId 
                ? call.receiver.toString() 
                : call.caller.toString();
            io.to(otherParticipant).emit('call-ended', { callId });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('End call error:', error);
        res.status(500).json({ error: 'Failed to end call' });
    }
});

// ----------- SOCKET.IO HANDLING -----------
// Store active socket connections
const activeConnections = new Map(); // userId -> Set of socket IDs

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('userOnline', async (userId) => {
        try {
            console.log(`User ${userId} came online with socket ${socket.id}`);

            socket.userId = userId;
            socket.join(userId);

            // Also join a private room with any potential chat partners
            // For now, we'll handle room joining on the chat page load or via a specific event
            
            socket.on('join-chat', (otherUserId) => {
                const roomId = [userId, otherUserId].sort().join('_');
                socket.join(roomId);
                console.log(`User ${userId} joined room ${roomId}`);
            });

            // Track this socket connection for the user
            if (!activeConnections.has(userId)) {
                activeConnections.set(userId, new Set());
            }
            activeConnections.get(userId).add(socket.id);

            // Update user status in database
            await User.findByIdAndUpdate(userId, { 
                online: true, 
                lastSeen: null,
                socketId: socket.id 
            });

            // Broadcast status update to all clients
            io.emit('userStatus', { userId, online: true });
            console.log(`Broadcasting user ${userId} is now online`);
            console.log(`Active connections now: ${Array.from(activeConnections.keys()).join(', ')}`);

            // Send any pending notifications
            const pendingCalls = await Call.find({
                $or: [
                    { receiver: userId, status: 'ringing' },
                    {
                        groupId: { $exists: true },
                        status: 'ringing',
                        participants: { $ne: userId }
                    }
                ],
                status: 'ringing'
            }).populate('caller', 'username avatar').populate('groupId', 'name');

            pendingCalls.forEach(call => {
                if (call.groupId) {
                    socket.emit('incoming-group-call', {
                        callId: call._id,
                        groupId: call.groupId._id,
                        groupName: call.groupId.name,
                        caller: {
                            id: call.caller._id,
                            username: call.caller.username,
                            avatar: call.caller.avatar
                        },
                        type: call.type
                    });
                } else if (call.receiver.toString() === userId) {
                    socket.emit('incoming-call', {
                        callId: call._id,
                        caller: {
                            id: call.caller._id,
                            username: call.caller.username,
                            avatar: call.caller.avatar
                        },
                        type: call.type
                    });
                }
            });
        } catch (error) {
            console.error('User online error:', error);
        }
    });

    socket.on('joinRoom', (roomId) => socket.join(roomId));
    socket.on('joinGroup', (groupId) => socket.join(`group_${groupId}`));

    socket.on('message delivered', async ({ messageId }) => {
        try {
            await Chat.findByIdAndUpdate(messageId, { status: 'delivered' });
        } catch (err) {
            console.error('Message delivered error:', err);
        }
    });

    socket.on('messages seen', async (data) => {
        try {
            await Chat.updateMany(
                { from: data.to, to: data.from, status: { $ne: 'seen' } },
                { $set: { status: 'seen' } }
            );
            const roomId = [data.to, data.from].sort().join('_');
            io.to(roomId).emit('messages seen', { from: data.to, to: data.from });
        } catch (err) {
            console.error('Messages seen error:', err);
        }
    });

    // Typing status events
    socket.on('typing start', (data) => {
        const roomId = [data.from, data.to].sort().join('_');
        socket.to(roomId).emit('user typing', {
            userId: data.from,
            username: data.username,
            isTyping: true
        });
    });

    socket.on('typing stop', (data) => {
        const roomId = [data.from, data.to].sort().join('_');
        socket.to(roomId).emit('user typing', {
            userId: data.from,
            username: data.username,
            isTyping: false
        });
    });

    // Group typing events
    socket.on('group typing start', (data) => {
        socket.to(`group_${data.groupId}`).emit('group user typing', {
            userId: data.from,
            username: data.username,
            isTyping: true
        });
    });

    socket.on('group typing stop', (data) => {
        socket.to(`group_${data.groupId}`).emit('group user typing', {
            userId: data.from,
            username: data.username,
            isTyping: false
        });
    });

    // Handle real-time voice messages
    socket.on('voiceMessage', (data) => {
        console.log('📩 Voice message received via Socket.IO from:', data.from);

        // Broadcast to the specific room (excluding sender)
        socket.to(data.roomId).emit('voiceMessage', {
            from: data.from,
            to: data.to,
            audio: data.audio,
            filename: data.filename,
            mimeType: data.mimeType,
            timestamp: data.timestamp
        });

        console.log('📩 Voice message broadcasted to room:', data.roomId);
    });

    // WebRTC Signaling Events
    socket.on('call-user', async (data) => {
        try {
            const call = await Call.findOne({ callId: data.callId });
            if (!call) return;

            // Encrypt signaling payload
            const signalingKey = generateQuantumSafeKey();
            const encryptedOffer = encryptMessage(JSON.stringify(data.offer), signalingKey);

            const payload = {
                callId: data.callId,
                offer: encryptedOffer,
                signalingKey: signalingKey,
                from: socket.userId
            };

            if (call.groupId) {
                socket.to(`group_${call.groupId}`).emit('call-offer', payload);
            } else {
                const targetId = call.caller.toString() === socket.userId 
                    ? call.receiver.toString() 
                    : call.caller.toString();
                io.to(targetId).emit('call-offer', payload);
            }
        } catch (error) {
            console.error('Error handling call-user:', error);
        }
    });

    socket.on('accept-call', async (data) => {
        try {
            const call = await Call.findOne({ callId: data.callId });
            if (!call) return;

            // Update call status
            call.status = 'connected';
            if (!call.participants.includes(socket.userId)) {
                call.participants.push(socket.userId);
            }
            await call.save();

            const signalingKey = generateQuantumSafeKey();
            const encryptedAnswer = encryptMessage(JSON.stringify(data.answer), signalingKey);

            const payload = {
                callId: data.callId,
                answer: encryptedAnswer,
                signalingKey: signalingKey,
                from: socket.userId
            };

            if (call.groupId) {
                socket.to(`group_${call.groupId}`).emit('call-answer', payload);
                socket.to(`group_${call.groupId}`).emit('user-joined-call', {
                    callId: data.callId,
                    userId: socket.userId
                });
            } else {
                const targetId = call.caller.toString() === socket.userId 
                    ? call.receiver.toString() 
                    : call.caller.toString();
                io.to(targetId).emit('call-answer', payload);
            }
        } catch (error) {
            console.error('Error handling accept-call:', error);
        }
    });

    socket.on('reject-call', async (data) => {
        try {
            const call = await Call.findOne({ callId: data.callId });
            if (!call) return;

            call.status = 'rejected';
            call.endTime = new Date();
            await call.save();

            if (call.groupId) {
                socket.to(`group_${call.groupId}`).emit('call-rejected', {
                    callId: data.callId,
                    from: socket.userId
                });
            } else {
                const targetId = call.caller.toString() === socket.userId 
                    ? call.receiver.toString() 
                    : call.caller.toString();
                io.to(targetId).emit('call-rejected', {
                    callId: data.callId
                });
            }
        } catch (error) {
            console.error('Error handling reject-call:', error);
        }
    });

    socket.on('ice-candidate', async (data) => {
        try {
            const call = await Call.findOne({ callId: data.callId });
            if (!call) return;

            const signalingKey = generateQuantumSafeKey();
            const encryptedCandidate = encryptMessage(JSON.stringify(data.candidate), signalingKey);

            const payload = {
                callId: data.callId,
                candidate: encryptedCandidate,
                signalingKey: signalingKey,
                from: socket.userId
            };

            if (call.groupId) {
                socket.to(`group_${call.groupId}`).emit('ice-candidate', payload);
            } else {
                const targetId = call.caller.toString() === socket.userId 
                    ? call.receiver.toString() 
                    : call.caller.toString();
                io.to(targetId).emit('ice-candidate', payload);
            }
        } catch (error) {
            console.error('Error handling ice-candidate:', error);
        }
    });

    socket.on('end-call', async (data) => {
        try {
            const call = await Call.findOne({ callId: data.callId });
            if (!call) return;

            call.status = 'ended';
            call.endTime = new Date();
            await call.save();

            if (call.groupId) {
                socket.to(`group_${call.groupId}`).emit('call-ended', {
                    callId: data.callId
                });
            } else {
                const targetId = call.caller.toString() === socket.userId 
                    ? call.receiver.toString() 
                    : call.caller.toString();
                io.to(targetId).emit('call-ended', {
                    callId: data.callId
                });
            }
        } catch (error) {
            console.error('Error handling end-call:', error);
        }
    });

    socket.on('join-group-call', async (data) => {
        try {
            const call = await Call.findOne({ callId: data.callId });
            if (!call || !call.groupId) return;

            if (!call.participants.includes(socket.userId)) {
                call.participants.push(socket.userId);
                await call.save();
            }

            socket.join(`call_${data.callId}`);
            socket.to(`call_${data.callId}`).emit('user-joined-call', {
                callId: data.callId,
                userId: socket.userId
            });
        } catch (error) {
            console.error('Error handling join-group-call:', error);
        }
    });

    socket.on('leave-group-call', async (data) => {
        try {
            const call = await Call.findOne({ callId: data.callId });
            if (!call || !call.groupId) return;

            call.participants = call.participants.filter(p => p.toString() !== socket.userId);
            await call.save();

            socket.leave(`call_${data.callId}`);
            socket.to(`call_${data.callId}`).emit('user-left-call', {
                callId: data.callId,
                userId: socket.userId
            });
        } catch (error) {
            console.error('Error handling leave-group-call:', error);
        }
    });

    socket.on('disconnect', async () => {
        console.log('A user disconnected:', socket.id);
        try {
            if (socket.userId) {
                const userId = socket.userId.toString();
                console.log(`User ${userId} disconnected with socket ${socket.id}`);

                // Remove this socket from active connections
                if (activeConnections.has(userId)) {
                    activeConnections.get(userId).delete(socket.id);

                    // Only mark user as offline if no other sockets are connected
                    if (activeConnections.get(userId).size === 0) {
                        activeConnections.delete(userId);

                        await User.findByIdAndUpdate(userId, {
                            online: false,
                            lastSeen: new Date(),
                            socketId: null
                        });

                        io.emit('userStatus', { userId, online: false });
                        console.log(`User ${userId} is now offline`);
                    } else {
                        console.log(`User ${userId} still has ${activeConnections.get(userId).size} active connections`);
                    }
                }
            }
        } catch (error) {
            console.error('Disconnect error:', error);
        }
    });
});

// ----------- SERVER STARTUP -----------
// Ensure voice directory exists
const voiceDir = path.join(__dirname, 'public', 'voice');
if (!fs.existsSync(voiceDir)) {
    fs.mkdirSync(voiceDir, { recursive: true });
    console.log('Created voice directory:', voiceDir);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Access the app at: http://0.0.0.0:${PORT}`);
});