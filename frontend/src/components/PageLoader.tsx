export default function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      <span className="ml-2">Loading...</span>
    </div>
  );
}
