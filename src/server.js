import dotenv from 'dotenv';
import { app } from './app.js';
import { connectDB } from './db.js';

// Load environment variables from .env file
dotenv.config();

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Establish connection to MongoDB Atlas
    await connectDB();
    
    // Start local server listener
    app.listen(PORT, () => {
      console.log(`[local] Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[local] Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
