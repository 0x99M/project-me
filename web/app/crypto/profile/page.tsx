"use client";

import { Button } from "@/components/ui/button";
import { useClerk } from "@clerk/nextjs";

export default function Profile() {
  const { signOut } = useClerk();

  return (
    <div className="w-full p-8 flex flex-col justify-center items-center" >
      <div className="w-full max-w-sm flex flex-col justify-center items-center gap-8" >
        <h1 className="text-4xl" >Profile</h1>
        <Button onClick={() => signOut({ redirectUrl: "/crypto/login" })} variant="destructive" className="w-full">
          Sign out
        </Button>
      </div>
    </div>
  );
}
