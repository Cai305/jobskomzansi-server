import mongoose, { Schema, Document } from 'mongoose';

export interface IApplication extends Document {
  jobId: string;
  userEmail: string;
  appliedAt: Date;
  status: string;
}

const ApplicationSchema: Schema = new Schema({
  jobId: { type: String, required: true },
  userEmail: { type: String, required: true },
  appliedAt: { type: Date, default: Date.now },
  status: { type: String, default: 'pending' }
});

export default mongoose.model<IApplication>('Application', ApplicationSchema);
