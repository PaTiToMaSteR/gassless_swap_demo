import { Navbar } from './Navbar';

interface LayoutProps {
    children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
    return (
        <div className="window">
            <div className="titlebar">
                <div className="title">Explorer — Blockchain Inspector</div>
                <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-400 opacity-20" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400 opacity-20" />
                    <div className="w-3 h-3 rounded-full bg-green-400 opacity-20" />
                </div>
            </div>
            <Navbar />
            <main className="p-4 overflow-y-auto max-h-[85vh]">
                {children}
            </main>
        </div>
    );
}
