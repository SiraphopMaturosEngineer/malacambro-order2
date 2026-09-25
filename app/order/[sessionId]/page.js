import OrderClient from './OrderClient';

export default async function OrderPage({ params }) {
  const { sessionId } = await params;

  return <OrderClient sessionId={sessionId} />;
}
