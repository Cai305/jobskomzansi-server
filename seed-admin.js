const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const MONGODB_URI = 'mongodb+srv://caiphus305_db_user:iWHHzU0cL0UoFt7i@cluster0.jbfumfu.mongodb.net/?appName=Cluster0';

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  role: { type: String, enum: ['candidate', 'employer', 'admin'], default: 'candidate' },
  isVerified: { type: Boolean, default: false },
  savedJobs: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

const UserModel = mongoose.model('User', UserSchema);

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const adminEmail = 'admin@jobs.com';
    const existingAdmin = await UserModel.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log('Admin already exists. Updating password...');
      existingAdmin.password = await bcrypt.hash('admin123', 10);
      existingAdmin.role = 'admin';
      existingAdmin.isVerified = true;
      await existingAdmin.save();
      console.log('Admin updated.');
    } else {
      console.log('Creating new admin...');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await new UserModel({
        email: adminEmail,
        password: hashedPassword,
        name: 'System Admin',
        role: 'admin',
        isVerified: true
      }).save();
      console.log('Admin created.');
    }
  } catch (err) {
    console.error('Error seeding admin:', err);
  } finally {
    await mongoose.disconnect();
  }
}

seed();
