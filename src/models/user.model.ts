import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String },
  role: { type: String, enum: ['candidate', 'employer', 'admin'], default: 'candidate' },
  isVerified: { type: Boolean, default: false },
  otp: { type: String },
  otpExpires: { type: Date },
  isVetted: { type: Boolean, default: false },
  vettingStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rejectionReason: { type: String },
  savedJobs: [{ type: String }], // Array of job IDs
  createdAt: { type: Date, default: Date.now }
});

export const UserModel = mongoose.model('User', UserSchema);
