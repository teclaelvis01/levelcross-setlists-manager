export interface Song {
    id: number;
    title: string;
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
declare module 'express-session' {
    interface SessionData {
        userId?: number;
        username?: string;
    }
}
//# sourceMappingURL=types.d.ts.map