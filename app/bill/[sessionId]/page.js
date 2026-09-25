import BillClient from './BillClient';

export default async function BillPage({ params }) {
  const { sessionId } = await params;

  return <BillClient sessionId={sessionId} />;
}
