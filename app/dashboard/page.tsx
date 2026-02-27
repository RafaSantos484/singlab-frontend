'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Fab,
  Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { SongPlayer } from '@/components/features/SongPlayer';
import { SongCreateDialog } from '@/components/features/SongCreateDialog';
import { useAuthGuard } from '@/lib/hooks/useAuthGuard';
import { useGlobalState } from '@/lib/store';
import { DashboardLayout } from '@/components/layout';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage(): React.ReactElement | null {
  const isLoading = useAuthGuard('private');
  const { userProfile, songs, songsStatus } = useGlobalState();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress size={32} />
      </Box>
    );
  }

  const user = userProfile;
  const displayName = user?.displayName ?? user?.email ?? 'User';

  return (
    <DashboardLayout>
      {/* Welcome card */}
      <Card
        sx={{
          mb: { xs: 4, sm: 5, lg: 6 },
          background: 'linear-gradient(135deg, rgba(19, 10, 53, 0.6) 0%, rgba(13, 7, 38, 0.4) 100%)',
          border: '1px solid rgba(45, 26, 110, 0.4)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography
            variant="body2"
            sx={{
              color: 'text.secondary',
              mb: 1,
            }}
          >
            Welcome back,
          </Typography>
          <Typography
            variant="h1"
            sx={{
              fontSize: { xs: '1.875rem', sm: '2.25rem', lg: '2.5rem' },
              fontWeight: 700,
              letterSpacing: '-0.02em',
              background:
                'linear-gradient(to right, #ededed, #818cf8)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {displayName}
          </Typography>
        </CardContent>
      </Card>

      {/* Songs section */}
      <Box component="section">
        {/* Section header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 3,
          }}
        >
          <Typography
            variant="h5"
            sx={{
              fontWeight: 600,
              color: 'text.primary',
            }}
          >
            Your songs
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              color: 'text.disabled',
            }}
          >
            {songs.length} track{songs.length !== 1 ? 's' : ''}
          </Typography>
        </Box>

        {/* Loading state */}
        {songsStatus === 'loading' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 2,
              borderRadius: 2,
              border: '1px solid rgba(45, 26, 110, 0.3)',
              bgcolor: 'rgba(10, 5, 32, 0.2)',
            }}
          >
            <CircularProgress size={16} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Loading songs…
            </Typography>
          </Box>
        )}

        {/* Error state */}
        {songsStatus === 'error' && (
          <Alert severity="error">
            Failed to load songs. Please refresh the page.
          </Alert>
        )}

        {/* Empty state */}
        {(songsStatus === 'ready' || songsStatus === 'idle') &&
          songs.length === 0 && (
            <Box
              sx={{
                p: 5,
                textAlign: 'center',
                borderRadius: 3,
                border: '2px dashed rgba(45, 26, 110, 0.3)',
                bgcolor: 'rgba(10, 5, 32, 0.2)',
              }}
            >
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                No songs yet. Upload your first track to get started.
              </Typography>
            </Box>
          )}

        {/* Songs grid */}
        {songs.length > 0 && (
          <Stack spacing={{ xs: 2, md: 3 }}>
            {songs.map((song) => (
              <Card
                key={song.id}
                sx={{
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  '&:hover': {
                    borderColor: 'rgba(124, 58, 237, 0.6)',
                    bgcolor: 'rgba(19, 10, 53, 0.7)',
                  },
                }}
              >
                <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
                  {/* Song metadata */}
                  <Box
                    sx={{
                      mb: 2,
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="body1"
                        sx={{
                          fontWeight: 600,
                          color: 'text.primary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {song.title}
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: 'text.secondary',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {song.author}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Song player */}
                  <Box
                    sx={{
                      overflow: 'hidden',
                      borderRadius: 2,
                    }}
                  >
                    <SongPlayer song={song} />
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>

      {/* FAB button to create new song */}
      <Fab
        color="primary"
        aria-label="add song"
        onClick={() => setIsCreateDialogOpen(true)}
        sx={{
          position: 'fixed',
          bottom: { xs: 24, sm: 32 },
          right: { xs: 24, sm: 32 },
          background: 'linear-gradient(135deg, #a78bfa 0%, #c4b5fd 100%)',
          color: '#1a0e2e',
          '&:hover': {
            background: 'linear-gradient(135deg, #b8a3e0 0%, #d4c4ff 100%)',
            boxShadow: '0 8px 24px rgba(168, 85, 247, 0.4)',
          },
          '&:active': {
            boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)',
          },
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <AddIcon sx={{ fontSize: '1.75rem', fontWeight: 600 }} />
      </Fab>

      {/* Song creation modal */}
      <SongCreateDialog
        open={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
      />
    </DashboardLayout>
  );
}
