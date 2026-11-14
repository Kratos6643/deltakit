# Hosting DeltaKit

Use either Cloudflare Pages alone, or AWS Lambda behind CloudFront with Cloudflare providing DNS. Both serve the same browser app. You do not need Docker, nginx, API Gateway, a database, or file uploads.

## Option 1: Cloudflare Pages

This is the simplest option for this static app. [Static asset requests are free and unlimited](https://developers.cloudflare.com/pages/functions/pricing/); account and build limits still apply.

1. In Cloudflare, open **Workers & Pages** and choose the option to create a **Pages** project connected to Git.
2. Connect GitHub and select `Kratos6643/deltakit`, branch `main`. Grant access to this repository.
3. Set the framework preset to **React (Vite)**, build command to `npm run build`, output directory to `dist`, and leave the root directory at the repository root. If setting the build Node version explicitly, use Node 24.
4. Deploy, then open the generated `pages.dev` address. Test Compare, Convert, Decode, and Lists.
5. In the project, open **Custom domains → Set up a domain**, and enter `deltakit.avinashrapolu.com`. Follow the DNS confirmation; the domain is already managed in Cloudflare. Wait for domain validation and HTTPS activation.
6. Open `https://deltakit.avinashrapolu.com/compare` directly, then refresh. Pages provides SPA fallback automatically when no top-level `404.html` exists, as in this project.
7. Future pushes to `main` trigger deployments. This option uses `npm run build`, not the Lambda packaging command.

References: [build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [SPA routing](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Option 2: AWS Lambda + CloudFront + Cloudflare DNS

Traffic flows from `deltakit.avinashrapolu.com` to CloudFront, then to a Lambda Function URL. Cloudflare remains the DNS provider. The included adapter only serves `dist/`; file comparison and decoding still happen in each visitor's browser.

### 1. Build the upload package

From the project directory, with Node 24 and the `zip` command installed:

```bash
npm ci
npm run package:lambda
```

Upload `release/deltakit-lambda.zip`. It contains `index.mjs`, `dist/`, and the icon license inside `dist/licenses/`. Dependencies, Git history, and source files are excluded. The ZIP is generated and ignored by Git.

### 2. Create the Lambda function

1. In the AWS Lambda console, choose an available region such as `ap-south-1` (Mumbai).
2. Create a function named `deltakit` using the **Node.js 24** runtime and a basic Lambda execution role. Do not attach it to a VPC; it has no backend network dependencies.
3. Under **Code → Upload from → .zip file**, upload the generated ZIP.
4. Set **Runtime settings → Handler** to `index.handler`. Start with 128 MB memory and a 5-second timeout.
5. Under **Configuration → Function URL**, create a URL with auth type **AWS_IAM** and buffered responses. Copy the URL. Direct browser access to this URL is intentionally denied without signing; CloudFront will sign its origin requests.

See [Lambda Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html).

### 3. Request the HTTPS certificate

1. Switch AWS Certificate Manager to **US East (N. Virginia), `us-east-1`**. CloudFront requires its viewer certificate in this region, even if Lambda is in Mumbai.
2. Request a public certificate for `deltakit.avinashrapolu.com`, using DNS validation.
3. Copy ACM's validation CNAME name and value into Cloudflare DNS. Keep this validation record **DNS only** (gray cloud). If Cloudflare appends the zone automatically, avoid entering `avinashrapolu.com` twice.
4. Wait until ACM reports **Issued**. Retain the validation record for certificate renewal.

See [CloudFront certificate requirements](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

### 4. Create CloudFront and authorize it

1. Create a CloudFront distribution. Use the Lambda Function URL hostname as the origin, without `https://` or a trailing slash. Origin protocol: **HTTPS only**; leave origin path empty.
2. Use the **Free flat-rate plan** if available and suitable for your account. Review the selected plan and any separately billed services before creating it.
3. For origin access, create an **Origin Access Control (OAC)** of type **Lambda**, with **Sign requests / Always** enabled. Attach it to this origin. The Lambda URL must remain `AWS_IAM`.
4. Allow **GET and HEAD**, redirect HTTP viewers to HTTPS, and enable automatic compression. Use the managed **CachingOptimized** policy; no cookies, query strings, or viewer Authorization headers are needed for this app.
5. Set the alternate domain name to `deltakit.avinashrapolu.com`, and select the ACM certificate from the previous step. The adapter handles `/` and the app routes, so leave the origin path and default root object empty.
6. Grant the distribution permission to call Lambda. In AWS CloudShell (or an authenticated AWS CLI), replace `AWS_ACCOUNT_ID` and `DISTRIBUTION_ID` below. Use your Lambda region if different:

```bash
aws lambda add-permission \
  --region ap-south-1 \
  --function-name deltakit \
  --statement-id AllowCloudFrontUrl \
  --action lambda:InvokeFunctionUrl \
  --principal cloudfront.amazonaws.com \
  --source-arn arn:aws:cloudfront::AWS_ACCOUNT_ID:distribution/DISTRIBUTION_ID

aws lambda add-permission \
  --region ap-south-1 \
  --function-name deltakit \
  --statement-id AllowCloudFrontInvoke \
  --action lambda:InvokeFunction \
  --principal cloudfront.amazonaws.com \
  --source-arn arn:aws:cloudfront::AWS_ACCOUNT_ID:distribution/DISTRIBUTION_ID
```

7. Wait for the distribution to finish deploying, then test its `https://…cloudfront.net` address. If it returns 403, check both permissions, the distribution ARN, OAC signing, and the Lambda URL auth type.

These are ordinary regional Lambda Function URLs, not Lambda@Edge. See [AWS's OAC and permission instructions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html).

### 5. Point the subdomain from Cloudflare

In the `avinashrapolu.com` zone, add this DNS record:

| Type | Name | Target | Proxy status |
| --- | --- | --- | --- |
| CNAME | `deltakit` | Your distribution's `…cloudfront.net` hostname | **DNS only** (gray cloud) |

CloudFront supplies HTTPS and CDN delivery for this path. You do not need Route 53 or to move your domain. Use the hostname only, without a scheme or path. Leave existing website and mail DNS records as they are.

Wait for DNS propagation, then test the home page, each tool, direct navigation to `/compare`, theme switching, and a downloaded report at `https://deltakit.avinashrapolu.com`.

### 6. Publish updates

Run `npm run package:lambda` again, upload the new ZIP to Lambda, and invalidate `/*` on the CloudFront distribution after the function update completes. Hashed assets have long cache lifetimes; invalidation refreshes the HTML entry points and unchanged filenames. Wait for invalidation before checking the new version.

### Costs

Lambda lists a monthly free allowance of 1 million requests and 400,000 GB-seconds. It is shared with other eligible Lambda usage in your account. CloudFront's Free flat-rate plan is distinct from its pay-as-you-go free tier. Logs and other services may be billed separately, so review account eligibility and your chosen configuration; this setup is not a guarantee of a zero bill.

Sources checked November 14, 2026: [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [CloudFront plans](https://aws.amazon.com/cloudfront/pricing/), [Cloudflare DNS proxy status](https://developers.cloudflare.com/dns/proxy-status/).
