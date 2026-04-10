import { Suspense } from 'react';
import Header from '@/components/Header';
import BottomNav from '@/components/BottomNav';
import LeaveApplicationForm from '@/components/LeaveApplicationForm';

export default function LeaveApplyPage() {
    return (
        <>
            <Header />
            <Suspense fallback={
                <main className="page">
                    <div className="container">
                        <div className="loading" style={{ minHeight: '60vh' }}>
                            <div className="spinner" />
                        </div>
                    </div>
                </main>
            }>
                <LeaveApplicationForm />
            </Suspense>
            <BottomNav />
        </>
    );
}
