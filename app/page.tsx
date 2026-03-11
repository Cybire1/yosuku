import HeroSection from '@/components/landing/HeroSection';
import Header from '@/components/Header';
import HowItWorks from '@/components/landing/HowItWorks';
import FeaturesScroll from '@/components/landing/FeaturesScroll';
import FinalCTA from '@/components/landing/FinalCTA';
import Footer from '@/components/Footer';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <Header />
      <HeroSection />
      <HowItWorks />
      <FeaturesScroll />
      <FinalCTA />
      <Footer />
    </main>
  );
}
