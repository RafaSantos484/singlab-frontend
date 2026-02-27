import { Box, Container, Card, CardContent } from '@mui/material';
import { SingLabLogo } from '@/components/ui/SingLabLogo';
import { WaveformDecoration } from '@/components/ui/WaveformDecoration';
import { SpectrumDecoration } from '@/components/ui/SpectrumDecoration';

interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

/**
 * Shared layout for authentication pages (login, register).
 *
 * Features:
 * - Centered card with decorative background glows
 * - SingLab logo and branding
 * - Responsive padding and max-width
 * - Decorative spectrum bars and waveforms (desktop only)
 * - Accessible structure with semantic HTML
 */
export function AuthLayout({
  children,
  title = 'SingLab',
  subtitle,
}: AuthLayoutProps): React.ReactElement {
  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        bgcolor: 'background.default',
        px: { xs: 2, sm: 3, lg: 4 },
        py: { xs: 6, sm: 8, lg: 10 },
      }}
    >
      {/* Background ambient glows */}
      <Box
        component="div"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {/* Top-center purple glow */}
        <Box
          sx={{
            position: 'absolute',
            left: '50%',
            top: '-10%',
            width: { xs: '95vw', sm: '90vw' },
            maxWidth: '768px',
            height: '70vh',
            transform: 'translateX(-50%)',
            borderRadius: '50%',
            backgroundColor: 'rgba(79, 70, 229, 0.1)',
            filter: 'blur(120px)',
          }}
        />
        {/* Left accent glow */}
        <Box
          sx={{
            position: 'absolute',
            left: '-5%',
            top: '33%',
            width: { xs: '45vw', sm: '40vw' },
            maxWidth: '384px',
            height: '40vh',
            borderRadius: '50%',
            backgroundColor: 'rgba(124, 58, 237, 0.08)',
            filter: 'blur(100px)',
          }}
        />
        {/* Bottom-right accent glow */}
        <Box
          sx={{
            position: 'absolute',
            bottom: '-5%',
            right: '-5%',
            width: { xs: '40vw', sm: '35vw' },
            maxWidth: '320px',
            height: '35vh',
            borderRadius: '50%',
            backgroundColor: 'rgba(168, 85, 247, 0.08)',
            filter: 'blur(90px)',
          }}
        />
      </Box>

      {/* Decorative spectrum bars — top-right (desktop) */}
      <Box
        component="div"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          right: 24,
          top: 24,
          pointerEvents: 'none',
          display: { xs: 'none', lg: 'block' },
        }}
      >
        <SpectrumDecoration className="h-28 w-52 opacity-70" />
      </Box>

      {/* Decorative spectrum bars — bottom-left (desktop) */}
      <Box
        component="div"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          bottom: 24,
          left: 24,
          pointerEvents: 'none',
          display: { xs: 'none', lg: 'block' },
          transform: 'rotate(180deg)',
        }}
      >
        <SpectrumDecoration className="h-20 w-40 opacity-50" />
      </Box>

      {/* Decorative waveform — bottom edge */}
      <Box
        component="div"
        aria-hidden="true"
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          pointerEvents: 'none',
          display: { xs: 'none', md: 'block' },
        }}
      >
        <WaveformDecoration className="w-full" />
      </Box>

      {/* Main card */}
      <Container
        maxWidth="sm"
        sx={{
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Glow border layer */}
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute',
            inset: '-1px',
            borderRadius: 4,
            background:
              'linear-gradient(135deg, rgba(124, 58, 237, 0.4) 0%, rgba(168, 85, 247, 0.2) 50%, rgba(192, 132, 252, 0.4) 100%)',
            filter: 'blur(8px)',
            pointerEvents: 'none',
          }}
        />

        <Card
          sx={{
            position: 'relative',
            borderRadius: 4,
            border: '1px solid rgba(45, 26, 110, 0.4)',
            bgcolor: 'rgba(10, 5, 32, 0.85)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 24px 48px rgba(124, 58, 237, 0.05)',
          }}
        >
          <CardContent
            sx={{
              px: { xs: 4, sm: 5 },
              py: { xs: 5, sm: 6 },
            }}
          >
            {/* Logo + Title */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                textAlign: 'center',
                mb: 4,
              }}
            >
              <SingLabLogo />
              <Box>
                <Box
                  component="h1"
                  sx={{
                    fontSize: { xs: '1.875rem', sm: '2.25rem' },
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    background:
                      'linear-gradient(to right, #818cf8, #a855f7, #c084fc)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    mb: 1,
                  }}
                >
                  {title}
                </Box>
                {subtitle && (
                  <Box
                    component="p"
                    sx={{
                      fontSize: '0.875rem',
                      color: 'text.secondary',
                      mt: 0.5,
                    }}
                  >
                    {subtitle}
                  </Box>
                )}
              </Box>
            </Box>

            {/* Content slot */}
            {children}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
