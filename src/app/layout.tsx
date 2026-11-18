import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import Shell from "@/components/Shell";

export const metadata: Metadata = {
  title: "Clippahh — AI video clipping",
  description: "Turn long videos into engaging short-form clips with multi-signal AI highlight detection.",
};

const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem('clippahh-theme')||'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
