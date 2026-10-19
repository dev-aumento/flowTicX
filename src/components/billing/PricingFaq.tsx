import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// Answers restate what the pricing page already promises (free plan, clients free, all modules included).
const FAQS = [
  {
    question: "Is there a free trial available?",
    answer:
      "Yes. You can start on the Free plan at no cost, and every paid plan begins with a free first month. Pick a plan, create your account, and you only pay once you decide to continue after that month.",
  },
  {
    question: "Does aaso charge extra for separate modules?",
    answer:
      "No. Projects, people, clients, time tracking, finance, and AI are part of your plan, so there are no separate apps or add-on fees. Higher plans unlock more advanced capabilities and larger limits.",
  },
  {
    question: "What is included in an aaso plan?",
    answer:
      "Every plan includes project and task management, time tracking, a client portal, and cloud storage. As you move up, you add CRM, invoicing, HR and people operations, automations, AI insights, and enterprise security. The comparison table above lists everything plan by plan.",
  },
  {
    question: "Can I invite clients to aaso without paying for additional seats?",
    answer:
      "Yes. Clients, guests, and stakeholders are always free. They can review work, collaborate, and approve deliverables through the client portal without using one of your paid team seats.",
  },
  {
    question: "What types of teams can use aaso?",
    answer:
      "aaso is built for service businesses of every size: freelancers, agencies, consultancies, and multi-team organizations. Plans scale from small teams on the Free plan to 100+ members on Enterprise.",
  },
];

export function PricingFaq() {
  return (
    <section className="px-4 py-10 sm:px-6 sm:py-[60px] lg:px-8">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center gap-8 sm:gap-10">
        <div className="flex max-w-[602px] flex-col items-center gap-3 text-center sm:gap-4">
          <p className="text-sm font-semibold uppercase text-[#2563eb]">Got questions?</p>
          <h2 className="text-[28px] font-extrabold leading-tight text-black sm:text-[36px] sm:leading-normal">
            Frequently Asked Questions
          </h2>
          <p className="text-base leading-6 text-[#8c9dac]">Clear answers to help you make an effortless decision.</p>
        </div>

        <Accordion type="single" collapsible className="flex w-full flex-col gap-3 sm:gap-4">
          {FAQS.map(({ question, answer }) => (
            <AccordionItem
              key={question}
              value={question}
              className="group/faq rounded-[8px] border border-transparent bg-white px-4 shadow-[0px_1px_1px_rgba(0,0,0,0.05)] transition-[border-color,box-shadow] duration-200 last:border-b hover:border-[rgba(37,99,235,0.3)] hover:shadow-[0px_6px_18px_-6px_rgba(37,99,235,0.25)] data-[state=open]:border-[rgba(37,99,235,0.3)]"
            >
              {/* The built-in chevron is hidden; the Figma chevron below flips when the item opens. */}
              <AccordionTrigger className="items-center rounded-[8px] py-[15px] text-base leading-[22px] text-[#0b1c30] hover:no-underline sm:py-[17px] sm:text-lg sm:leading-[22px] [&>svg]:hidden">
                {/* Set on a span: the trigger sits in an <h3> (Plus Jakarta by default), and cn() would drop an arbitrary font family next to a weight. */}
                <span className="font-['Inter'] font-normal transition-colors duration-200 group-hover/faq:text-[#2563eb] group-data-[state=open]/faq:text-[#2563eb]">
                  {question}
                </span>
                <span
                  aria-hidden
                  className="-my-1.5 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[#2563eb] transition-colors duration-200 group-hover/faq:bg-[rgba(37,99,235,0.1)]"
                >
                  <svg
                    width="12"
                    height="7.4"
                    viewBox="0 0 12 7.4"
                    fill="currentColor"
                    className="transition-transform duration-200 group-data-[state=open]/faq:rotate-180"
                  >
                    <path d="M6 7.4L0 1.4L1.4 0L6 4.6L10.6 0L12 1.4L6 7.4Z" />
                  </svg>
                </span>
              </AccordionTrigger>
              <AccordionContent className="max-w-[1100px] pb-[18px] text-sm leading-6 text-[#434655] sm:text-base">
                {answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
