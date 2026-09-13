import { OfficeParser } from "officeparser";

function nodes(items) {
  return items.map((node) => ({
    type: node.type,
    text: node.text,
    metadata: node.metadata,
    children: node.children ? nodes(node.children) : undefined,
    notes: node.notes,
  }));
}
try {
  const ast = await OfficeParser.parseOffice(process.argv[2], {
    ocr: false,
    extractAttachments: false,
  });
  process.stdout.write(
    JSON.stringify({
      status: "extracted",
      text: (await ast.to("text")).value,
      nodes: nodes(ast.content),
    }),
  );
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      status: "rejected",
      message: error.message.replaceAll(process.cwd(), "<project>"),
    }),
  );
}
