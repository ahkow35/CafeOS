export default function Loading() {
  return (
    <main className="page">
      <div className="container">
        <section className="section">
          <div className="skeleton" style={{ height: 28, width: '60%', marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 16, width: '40%' }} />
        </section>
        <section className="section">
          <div className="skeleton" style={{ height: 20, width: '30%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 80, borderRadius: 8 }} />
        </section>
        <section className="section">
          <div className="skeleton" style={{ height: 20, width: '35%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 64, borderRadius: 8, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 64, borderRadius: 8 }} />
        </section>
      </div>
    </main>
  );
}
