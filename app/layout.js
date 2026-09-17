import './globals.css';
import { DatasetProvider } from '../lib/store/DatasetProvider';
import { TutorialProvider } from '../lib/store/TutorialProvider';
import { PlanProvider } from '../lib/store/PlanProvider';
import TutorialOverlay from '../components/panels/TutorialOverlay';
import { AppearanceScript } from '../components/shell/ThemeToggle';

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
        <AppearanceScript />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          * Three faces in one request: a serif for titles, a humanist sans for
          * the interface, and a monospace for the things that have to line up.
          * Fraunces is asked for with its optical-size, softness and wonk axes
          * so `.display` can dial them per size rather than taking the defaults.
          */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,SOFT,WONK,wght@9..144,0..100,0..1,300..900&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-canvas text-white font-sans" suppressHydrationWarning>
        <DatasetProvider>
          <PlanProvider>
            <TutorialProvider>
              {children}
              <TutorialOverlay />
            </TutorialProvider>
          </PlanProvider>
        </DatasetProvider>
      </body>
    </html>
  );
}
