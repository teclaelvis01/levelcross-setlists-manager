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

export interface Person {
  id: number;
  name: string;
  photo_url: string;
  deleted_at: string | null;
  created_at: string;
}

export interface PersonRole {
  id: number;
  person_id: number;
  role: string;
}

export interface Activity {
  id: number;
  name: string;
  activity_date: string;
  activity_time: string;
  detail: string;
  created_at: string;
  updated_at: string;
}

export interface ActivitySong {
  id: number;
  activity_id: number;
  song_id: number;
  position: number;
}

export interface ActivityPersonRole {
  id: number;
  activity_id: number;
  person_id: number;
  role: string;
}

export interface MusicalRole {
  id: number;
  name: string;
  position: number;
  created_at: string;
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
    flash?: {
      type: 'error' | 'success' | 'info';
      message: string;
    };
  }
}