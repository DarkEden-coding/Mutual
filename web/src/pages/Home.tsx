import { Link } from 'react-router';
import { HomeHero, HomeSections } from '../components/HomeSections';
import '../styles/home.css';

export function Home() {
  return (
    <div className="m-page m-home">
      <HomeHero />
      <HomeSections />
      <section className="m-card m-home-cta" aria-labelledby="cta-title">
        <h2 id="cta-title">Ready to find a time?</h2>
        <p>It takes about 30 seconds and nobody needs an account.</p>
        <Link to="/new" className="m-button is-primary">
          Create a meet
        </Link>
      </section>
    </div>
  );
}
