import '@testing-library/jest-dom';

// Set test environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'test-api-key';
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'test-project.firebaseapp.com';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'test-project.appspot.com';
process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '123456789';
process.env.NEXT_PUBLIC_FIREBASE_APP_ID = 'test-app-id';

// Mock Firebase modules to avoid fetch dependency issues in tests
jest.mock('@/lib/firebase/auth', () => ({
  getFirebaseAuth: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
  getCurrentUserIdToken: jest.fn(() => Promise.resolve('mock-token')),
  sendVerificationEmail: jest.fn(),
  initiateEmailVerification: jest.fn(),
}));

jest.mock('@/lib/firebase/firestore', () => ({
  getFirebaseFirestore: jest.fn(),
}));

jest.mock('@/lib/firebase/app', () => ({
  getFirebaseApp: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
  getAuth: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(),
  collection: jest.fn(),
  onSnapshot: jest.fn(),
}));

jest.mock('next-intl', () => ({
  useTranslations: jest.fn(() => (key: string) => key),
}));

jest.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: jest.fn(),
}));

jest.mock('@ffmpeg/util', () => ({
  fetchFile: jest.fn(),
  toBlobURL: jest.fn(),
}));
