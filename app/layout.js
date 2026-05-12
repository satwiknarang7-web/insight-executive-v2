import './globals.css'

export const metadata = {
  title: 'NL2Query Engine',
  description: 'Natural Language to SQL Engine',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased m-0 p-0 overflow-hidden bg-black h-full font-sans">
        {children}
      </body>
    </html>
  )
}
