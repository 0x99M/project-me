"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="h-18" ></div>
      <Card className="w-full max-w-sm bg-black/0 border-none shadow-none">
        <CardHeader>
          <CardTitle className="text-center text-4xl">
            <h3>Chart Swipe</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col justify-center items-center" >
          <SignIn routing="hash" />
        </CardContent>
      </Card>
    </div>
  );
}
