import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Container, PageIntro } from "@/components/site/layout-primitives";
import { formatDate, getPosts } from "@/lib/content/blog";

export const metadata: Metadata = {
  title: "Blog",
  description: "Guides and product news for people who make talking videos.",
};

export default function BlogPage() {
  const [featured, ...rest] = getPosts();

  return (
    <>
      <PageIntro title="Blog" lead="Practical guides for better talking videos, and news from the Shortcraft team." />
      <Container className="pb-28">
        <Link href={`/blog/${featured.slug}`} className="group grid items-center gap-8 md:grid-cols-[1.2fr_1fr] md:gap-14">
          <div className="relative aspect-[16/10] overflow-hidden rounded-[20px] bg-surface">
            <Image
              src={featured.cover}
              alt=""
              fill
              sizes="(min-width: 768px) 55vw, 100vw"
              className="object-cover object-[center_22%] transition-transform duration-500 group-hover:scale-[1.03]"
            />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {featured.category} · {formatDate(featured.date)}
            </p>
            <h2 className="mt-3 text-[2rem] leading-tight font-semibold tracking-[-0.03em] group-hover:underline group-hover:decoration-line group-hover:underline-offset-8">
              {featured.title}
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">{featured.excerpt}</p>
          </div>
        </Link>

        <ul className="mt-20 grid gap-x-8 gap-y-14 border-t pt-14 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((post) => (
            <li key={post.slug}>
              <Link href={`/blog/${post.slug}`} className="group block">
                <div className="relative aspect-[16/10] overflow-hidden rounded-[20px] bg-surface">
                  <Image
                    src={post.cover}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover object-[center_22%] transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                </div>
                <p className="mt-5 text-sm text-muted-foreground">
                  {post.category} · {post.readMinutes} min read
                </p>
                <h3 className="mt-2 text-xl leading-snug font-semibold tracking-[-0.015em]">{post.title}</h3>
                <p className="mt-2 text-[15px] text-muted-foreground">{post.excerpt}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
