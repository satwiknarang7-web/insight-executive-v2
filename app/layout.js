import './globals.css';
import { DatasetProvider } from '../lib/store/DatasetProvider';
import { DashboardProvider } from '../lib/store/DashboardProvider';
import { PlanProvider } from '../lib/store/PlanProvider';
import Assistant from '../components/assistant/Assistant';
import AssistantBoundary from '../components/assistant/AssistantBoundary';
import { AppearanceScript } from '../components/shell/ThemeToggle';

export const metadata = {
  title: 'Insight Executive',
  description: 'Upload a dataset and get the dashboard an analyst would build for it.',
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
          href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-canvas text-white font-sans" suppressHydrationWarning>
        <DatasetProvider>
          <DashboardProvider>
          <PlanProvider>
            {children}
            <AssistantBoundary>
              <Assistant />
            </AssistantBoundary>
          </PlanProvider>
          </DashboardProvider>
        </DatasetProvider>
      </body>
    </html>
  );
}
