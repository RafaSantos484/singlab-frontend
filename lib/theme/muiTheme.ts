import { createTheme } from '@mui/material/styles';

/**
 * SingLab MUI Theme
 *
 * Consolidates brand colors, typography, spacing, and component defaults
 * to ensure consistent styling across the application.
 *
 * Brand colors match the Tailwind design tokens defined in globals.css.
 */
const muiTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#7c3aed', // brand-300
      light: '#a855f7', // brand-200
      dark: '#4c2aad', // brand-400
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#818cf8', // accent-300
      light: '#a5b4fc', // accent-200
      dark: '#6366f1', // accent-400
      contrastText: '#ffffff',
    },
    background: {
      default: '#0a0520', // brand-900
      paper: '#130a35', // brand-700 (elevated surface)
    },
    text: {
      primary: '#ededed', // foreground
      secondary: 'rgba(237, 237, 237, 0.7)', // foreground with opacity
      disabled: 'rgba(237, 237, 237, 0.4)',
    },
    error: {
      main: '#ef4444', // red-500
      light: '#f87171', // red-400
      dark: '#dc2626', // red-600
    },
    success: {
      main: '#10b981', // green-500
      light: '#34d399', // green-400
      dark: '#059669', // green-600
    },
    warning: {
      main: '#f59e0b', // amber-500
      light: '#fbbf24', // amber-400
      dark: '#d97706', // amber-600
    },
    info: {
      main: '#3b82f6', // blue-500
      light: '#60a5fa', // blue-400
      dark: '#2563eb', // blue-600
    },
    divider: 'rgba(124, 58, 237, 0.2)', // brand-300 with opacity
  },
  typography: {
    fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
    h1: {
      fontSize: '2.5rem',
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 700,
      letterSpacing: '-0.01em',
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    h5: {
      fontSize: '1.125rem',
      fontWeight: 600,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
    },
    body1: {
      fontSize: '1rem',
      lineHeight: 1.6,
    },
    body2: {
      fontSize: '0.875rem',
      lineHeight: 1.5,
    },
    button: {
      textTransform: 'none', // Disable uppercase transformation
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 12, // Modern, rounded corners
  },
  spacing: 8, // 8px base unit (MUI default)
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          padding: '10px 20px',
          fontSize: '0.875rem',
          fontWeight: 600,
          boxShadow: 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(124, 58, 237, 0.2)',
          },
        },
        contained: {
          background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #6d28d9 0%, #9333ea 100%)',
            boxShadow: '0 8px 16px rgba(124, 58, 237, 0.3)',
          },
        },
        outlined: {
          borderColor: 'rgba(124, 58, 237, 0.4)',
          '&:hover': {
            borderColor: 'rgba(124, 58, 237, 0.6)',
            backgroundColor: 'rgba(124, 58, 237, 0.08)',
          },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 12,
            backgroundColor: 'rgba(19, 10, 53, 0.6)', // brand-700 with opacity
            '& fieldset': {
              borderColor: 'rgba(45, 26, 110, 0.6)', // brand-500
              transition: 'border-color 0.2s',
            },
            '&:hover fieldset': {
              borderColor: 'rgba(124, 58, 237, 0.5)', // brand-300
            },
            '&.Mui-focused fieldset': {
              borderColor: '#7c3aed', // brand-300
              borderWidth: '2px',
            },
            '&.Mui-error fieldset': {
              borderColor: '#ef4444', // red-500
            },
          },
          '& .MuiInputLabel-root': {
            color: 'rgba(237, 237, 237, 0.7)',
            '&.Mui-focused': {
              color: '#a855f7', // brand-200
            },
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontSize: '0.875rem',
        },
        standardError: {
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#fca5a5', // red-300
        },
        standardSuccess: {
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          color: '#6ee7b7', // green-300
        },
        standardInfo: {
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          color: '#93c5fd', // blue-300
        },
        standardWarning: {
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          color: '#fcd34d', // amber-300
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          backgroundColor: 'rgba(19, 10, 53, 0.5)', // brand-700 with opacity
          border: '1px solid rgba(45, 26, 110, 0.4)', // brand-500
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            borderColor: 'rgba(124, 58, 237, 0.5)',
            backgroundColor: 'rgba(19, 10, 53, 0.7)',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(10, 5, 32, 0.8)', // brand-900 with opacity
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(45, 26, 110, 0.4)', // brand-500
          boxShadow: 'none',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          backgroundColor: '#0d0726', // brand-800
          border: '1px solid rgba(124, 58, 237, 0.3)',
          boxShadow: '0 24px 48px rgba(5, 1, 18, 0.8)',
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: '1.5rem',
          fontWeight: 700,
          color: '#ededed',
          paddingBottom: '12px',
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          backgroundColor: '#7c3aed', // brand-300
          color: '#ffffff',
          fontWeight: 600,
        },
      },
    },
    MuiCircularProgress: {
      styleOverrides: {
        root: {
          color: '#a855f7', // brand-200
        },
      },
    },
    MuiSkeleton: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(45, 26, 110, 0.2)', // brand-500 with opacity
        },
      },
    },
    MuiFab: {
      styleOverrides: {
        root: {
          boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
          '&:hover': {
            boxShadow: '0 8px 24px rgba(124, 58, 237, 0.4)',
          },
        },
      },
    },
  },
});

export default muiTheme;
