import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CtaBand } from "@/components/site/cta-band";
import { Container } from "@/components/site/layout-primitives";
import { formatDate, getPost, getPosts } from "@/lib/content/blog";

export function generateStaticParams() {
  return getPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const post = getPost(slug);
  return post ? { title: post.title, description: post.excerpt } : {};
}

export default async function BlogPostPage(props: PageProps<"/blog/[slug]">) {
  const { slug } = await props.params;
  const post = getPost(slug);
  if (!post) notFound();

  const more = getPosts().filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <>
      <article className="pt-16 md:pt-24">
        <Container className="max-w-[760px]">
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-ink">
            <ArrowLeft className="size-4" /> All posts
          </Link>
          <p className="mt-10 text-sm text-muted-foreground">
            {post.category} · {formatDate(post.date)} · {post.readMinutes} min read
          </p>
          <h1 className="mt-4 text-[2.4rem] leading-[1.08] font-semibold tracking-[-0.035em] md:text-[3.25rem]">
            {post.title}
          </h1>
          <p className="mt-5 text-lead text-muted-foreground">{post.excerpt}</p>
        </Container>
        <Container className="mt-12 max-w-[1000px]">
          <div className="relative aspect-[16/9] overflow-hidden rounded-[24px] bg-surface">
            <Image src={post.cover} alt="" fill priority sizes="1000px" className="object-cover object-[center_22%]" />
          </div>
        </Container>
        <Container className="mt-14 max-w-[680px]">
          <div className="space-y-6 text-[18px] leading-[1.75] text-ink-2">
            {post.body.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </Container>
      </article>

      <Container className="mt-24 max-w-[1000px] border-t pt-12">
        <p className="text-sm font-medium">Keep reading</p>
        <ul className="mt-6 grid gap-8 sm:grid-cols-2">
          {more.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="group block">
                <h3 className="text-xl leading-snug font-semibold tracking-[-0.015em] group-hover:underline group-hover:decoration-line group-hover:underline-offset-4">
                  {p.title}
                </h3>
                <p className="mt-2 text-[15px] text-muted-foreground">{p.excerpt}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Container>

      <CtaBand />
    </>
  );
}
