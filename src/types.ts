export interface Song {
  id: number;
  title: string;
  slug: string;
  artist: string;
  lyrics: string;
  audio_url: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
}

// Extend express-session to include our custom fields
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
  }
}