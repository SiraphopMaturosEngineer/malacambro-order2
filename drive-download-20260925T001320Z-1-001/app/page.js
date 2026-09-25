import Link from 'next/link';
import styles from './page.module.css';

const ADULT_PRICE = 229;
const CHILD_PRICE = 129;

const links = [
  {
    href: '/generate-qr',
    icon: '🪑',
    title: 'เปิดโต๊ะ / สร้าง QR',
    desc: 'กรอกเลขโต๊ะและจำนวนลูกค้า แล้วให้ลูกค้าสแกนสั่งอาหาร',
  },
  {
    href: '/kitchen',
    icon: '🔥',
    title: 'หน้าจอครัว',
    desc: 'ดูออเดอร์ที่เข้ามาแบบเรียลไทม์',
  },
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <section className={styles.hero}>
          <div className={styles.emoji}>🌶️</div>
          <h1 className={styles.title}>หม่าล่าแคมโบร๋</h1>
          <p className={styles.tagline}>หม่าล่าบุฟเฟต์ · ระบบสั่งอาหารผ่าน QR</p>

          <div className={styles.prices}>
            <div className={styles.price}>
              <span className={styles.priceLabel}>ผู้ใหญ่</span>
              <span className={styles.priceValue}>
                {ADULT_PRICE}
                <span className={styles.priceUnit}>บาท</span>
              </span>
            </div>
            <div className={styles.price}>
              <span className={styles.priceLabel}>เด็ก</span>
              <span className={styles.priceValue}>
                {CHILD_PRICE}
                <span className={styles.priceUnit}>บาท</span>
              </span>
            </div>
          </div>
        </section>

        <nav className={styles.menu}>
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={styles.card}>
              <span className={styles.cardIcon}>{link.icon}</span>
              <span className={styles.cardText}>
                <span className={styles.cardTitle}>{link.title}</span>
                <span className={styles.cardDesc}>{link.desc}</span>
              </span>
              <span className={styles.arrow}>›</span>
            </Link>
          ))}
        </nav>

        <p className={styles.footer}>สำหรับพนักงานร้าน</p>
      </div>
    </main>
  );
}
