export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startImageServices } = await import('@backend/server/sftp-images/runtime');
    startImageServices(); // Starts work in background; never awaits a remote SFTP scan.
  }
}
