import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FAT8 Simulator',
  description: 'A fully functional FAT8 file system simulation.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
