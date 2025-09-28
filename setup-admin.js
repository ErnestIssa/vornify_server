const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://dev:MWV3Fp1ybznhRQXT@cluster0.dwv6j.mongodb.net/';

// Admin schema
const AdminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, default: 'admin' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const Admin = mongoose.model('Admin', AdminSchema);

async function setupAdmin() {
    try {
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log('Connected to MongoDB');

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email: 'admin@peakmode.com' });
        if (existingAdmin) {
            console.log('Admin user already exists');
            process.exit(0);
        }

        // Create admin user
        const hashedPassword = await bcrypt.hash('admin123', 10);
        const admin = new Admin({
            email: 'admin@peakmode.com',
            password: hashedPassword,
            name: 'Peak Mode Admin',
            role: 'admin',
            isActive: true
        });

        await admin.save();
        console.log('Admin user created successfully!');
        console.log('Email: admin@peakmode.com');
        console.log('Password: admin123');
        console.log('Please change the password after first login.');

    } catch (error) {
        console.error('Error setting up admin:', error);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

setupAdmin();
