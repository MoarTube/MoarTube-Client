const axios = require('axios').default;

const { 
    logDebugMessageToConsole
} = require('../utils/helpers');

async function cloudflare_addS3BucketCnameDnsRecord(cnameRecordName, cnameRecordContent, cloudflareCredentials) {
    return new Promise(async function(resolve, reject) {
        try {
            const cloudflareEmailAddress = cloudflareCredentials.cloudflareEmailAddress;
            const cloudflareZoneId = cloudflareCredentials.cloudflareZoneId;
            const cloudflareGlobalApiKey = cloudflareCredentials.cloudflareGlobalApiKey;

            logDebugMessageToConsole('verifying required CNAME DNS record: Name: ' + cnameRecordName + ' Content: ' + cnameRecordContent, null, null);

            logDebugMessageToConsole('querying CNAME DNS records...', null, null);
    
            const dnsRecordGetResponse = await axios.get(
                `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records?type=CNAME&name=${cnameRecordName}`,
                {
                    headers:
                    {
                        'X-Auth-Email': cloudflareEmailAddress,
                        'X-Auth-Key': cloudflareGlobalApiKey
                    }
                }
            );
            
            if(dnsRecordGetResponse.data.success) {
                logDebugMessageToConsole('successfully queried CNAME DNS records, verifying...', null, null);

                const dnsRecords = dnsRecordGetResponse.data.result;

                const recordExists = dnsRecords.some((record) => record.name === cnameRecordName && record.content === cnameRecordContent);
        
                if (recordExists) {
                    logDebugMessageToConsole('successfully verified required CNAME DNS record', null, null);

                    resolve();
                }
                else {
                    logDebugMessageToConsole('required CNAME DNS record does not exist, adding...', null, null);

                    const dnsRecordPostResponse = await axios.post(
                        `https://api.cloudflare.com/client/v4/zones/${cloudflareZoneId}/dns_records`,
                        {
                            type: 'CNAME',
                            name: cnameRecordName,
                            content: cnameRecordContent,
                            ttl: 1,
                            proxied: true,
                        },
                        {
                            headers:
                            {
                                'X-Auth-Email': cloudflareEmailAddress,
                                'X-Auth-Key': cloudflareGlobalApiKey
                            }
                        }
                    );
    
                    if(dnsRecordPostResponse.data.success) {
                        logDebugMessageToConsole('successfully added CNAME DNS record', null, null);

                        resolve();
                    }
                    else {
                        logDebugMessageToConsole('failed to add CNAME DNS record', null, null);

                        throw new Error('failed to add CNAME DNS record');
                    }
                }
            }
            else {
                logDebugMessageToConsole('failed to query DNS records from Cloudflare', null, null);

                throw new Error('failed to query DNS records from Cloudflare');
            }
        }
        catch(e) {
            reject(e);
        }
    });
}

module.exports = {
    cloudflare_addS3BucketCnameDnsRecord
};