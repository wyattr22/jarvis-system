import { Sidebar } from "@/components/sidebar"
import { VoiceAgent } from "@/components/voice-agent"
import { TextChat } from "@/components/text-chat"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <VoiceAgent />
      <TextChat />
    </div>
  )
}
