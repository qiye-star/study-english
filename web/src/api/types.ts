export interface AuthUser {
  id: string;
  name: string;
  createdAt: string;
  accessToken: string;
}

export interface UserProfile {
  id: string;
  name: string;
  createdAt: string;
}

export type Paged<K extends string, T> = { page: number; next: number | null } & Record<K, T[]>;
