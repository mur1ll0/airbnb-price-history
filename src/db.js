import mongoose from 'mongoose';
import dns from 'node:dns';

let isConnected = false;

function isSrvDnsRefused(error) {
  return (
    error &&
    error.code === 'ECONNREFUSED' &&
    error.syscall === 'querySrv' &&
    typeof error.hostname === 'string' &&
    error.hostname.startsWith('_mongodb._tcp.')
  );
}

/**
 * Establish connection to MongoDB Atlas and manage the pool.
 */
export async function connectDB() {
  if (isConnected) {
    return mongoose.connection;
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.warn('[database] MONGO_URI is not defined in environment variables; skipping connection.');
    return null;
  }

  try {
    await mongoose.connect(mongoUri);
    isConnected = true;
    console.log('[database] MongoDB connected successfully.');
    return mongoose.connection;
  } catch (error) {
    if (isSrvDnsRefused(error)) {
      console.warn('[database] SRV lookup failed via OS DNS. Retrying with Google DNS (8.8.8.8)...');
      try {
        dns.setServers(['8.8.8.8', '8.8.4.4']);
        await mongoose.connect(mongoUri);
        isConnected = true;
        console.log('[database] MongoDB connected successfully via Google DNS.');
        return mongoose.connection;
      } catch (dnsError) {
        console.error('[database] MongoDB connection retry with Google DNS failed:', dnsError);
        throw dnsError;
      }
    } else {
      console.error('[database] MongoDB connection error:', error);
      throw error;
    }
  }
}
