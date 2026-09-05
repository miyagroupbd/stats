"use client";

// /replies moved into Messages → Chats (MGB-429). Kept as a redirect so old
// bookmarks and links keep working.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";

export default function RepliesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/messages");
  }, [router]);
  return <Spinner label="Replies now live under Messages → Chats. Redirecting…" />;
}
