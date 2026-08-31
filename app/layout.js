import './globals.css';
import { DatasetProvider } from '../lib/store/DatasetProvider';
import { ThemeScript } from '../components/shell/ThemeToggle';

export const metadata = {
  title: 'Insight Executive',
  description: 'Upload a CSV and get a verified, explainable analysis of it.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#030303',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-canvas text-white font-sans" suppressHydrationWarning>
        <DatasetProvider>{children}</DatasetProvider>
      </body>
    </html>
  );
}
