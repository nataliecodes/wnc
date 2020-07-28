# WNC

An algorithm for mutual aid disbursements. This app is deployed via `Vercel` as a serverless function.

The `/api/donate.js` endpoint accepts data from `Pipedream` (which is triggered via a Slack notification which Airtable, the database for this function, triggers when updated).

## Set up

Run `npm install` to install the dependencies. You'll also need to globally install `vercel`, in order to test locally: `npm install -g vercel`.

Create a .env file and find these keys via your WNC contact:
AIRTABLE_API_KEY=
AIRTABLE_REQUESTS_TABLE=
AIRTABLE_REQUESTS_TABLE_ID=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

## Testing the endpoint

You can test hitting the URLs in postman. Locally, that URL will be `http://localhost:3000/api/donate.js`. Set your body to the expected JSON body.

Example: 

```
  [
    {
      "data": {
        "tableId": [TEST Donations from airtable],
        "recordId": "recq522EeWBD0uTZL",
        "updates": [
          { "field": "Name", "newValue": "New Name Value" },
          { "field": "Contribution", "newValue": "$1.00" },
          { "field": "Payment methods", "newValue": "CashApp, Paypal" },
          { "field": "Phone", "newValue": "<tel:(123)456-7890|(123) 456-7890>" }
        ]
      }
    }
  ]
```

Possible responses:
- 200 success! If everything works and the record gets updated properly, you'll see a 200 return with a sentence like: "Success! Message success id number: ${messageResponse.sid}. Record updated: ${request.id}, name: ${name}".
- 500 error. Could return an error if it's been triggered by the incorrect donations table. For local development or Vercel preview environments, this should be the TEST Donations table. In production it's just called Donations.
- 500 error. If all donations are met (!) or if there are no donations matching the payment type you volunteer (i.e. you filled out Venmo as your payment choice, but only people with CashApp still need money).
- 500 error. If there's an issue sending the text via Twilio, that will be caught.

## TODO
- Get best links to Paypal and Zelle to have a link in the text message, not just a phone number or email to copy and paste manually into those apps.
- Split up donations if someone offers $100, but, say there are only $50 donations left to two people - that should get sent two 2 people.
- Use TypeScript.
- Make sure errors are handled properly