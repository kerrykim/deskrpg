"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import Link from "next/link";

export default function JoinChannelPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
          Loading...
        </div>
      }
    >
      <JoinChannelPageInner />
    </Suspense>
  );
}

function JoinChannelPageInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const code = params.code as string;
  const characterId = searchParams.get("characterId");

  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;

    fetch(`/api/channels/join/${code}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }

        if (characterId) {
          // Has character selected, go directly to game
          router.replace(
            `/game?channelId=${data.channel.id}&characterId=${characterId}`,
          );
        } else {
          // Need to select character first, then come back
          router.replace(`/characters?joinChannel=${data.channel.id}`);
        }
      })
      .catch(() => {
        setError("Failed to resolve invite code");
      });
  }, [code, characterId, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-xl mb-4 text-red-400">{error}</div>
          <Link
            href="/channels"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded font-semibold"
          >
            Back to Channels
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      Joining channel...
    </div>
  );
}
