import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Miya Email Pipeline",
  description: "Lead-gen & cold-email automation dashboard for Miya Group",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <Toaster theme="dark" richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
