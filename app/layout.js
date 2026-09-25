export const metadata = {
  title: 'หม่าล่าแคมโบร๋',
  description: 'ระบบสั่งอาหารร้านหม่าล่าบุฟเฟต์ หม่าล่าแคมโบร๋',
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
