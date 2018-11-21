
import * as cloud from "@pulumi/cloud-aws"
import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { AWSQuicksightAthenaAccess } from "@pulumi/aws/iam";


export class infrastructure {

    private rdsConfig : pulumi.Config ;
    private dockerConfig : pulumi.Config ;
    constructor() {
        this.rdsConfig = new pulumi.Config("elasticcache");
        this.dockerConfig = new pulumi.Config("docker");
    }

    createInfrastructure(): void {




        let securityGroupIds = [cloud.getCluster()!.securityGroupId!];

        let cacheSubnets = new aws.elasticache.SubnetGroup("cachesubnets", {
            subnetIds: cloud.getNetwork().subnetIds,
        });

        let dataService = new aws.elasticache.Cluster("webcache", {
            clusterId: "cache-" + pulumi.getStack(),
            engine: "redis",

            nodeType: this.rdsConfig.require("nodeType"),
            numCacheNodes: this.rdsConfig.requireNumber("cacheNodes"),

            subnetGroupName: cacheSubnets.id,
            securityGroupIds: securityGroupIds,
        })

        async function createDNS(nodes: aws.elasticache.Cluster): Promise<String[]> {
            
            let dnsZone;
            try {
                dnsZone = await aws.route53.getZone({ name: "williamhill-dev1.com" });
            } catch (error) {
                dnsZone = await new aws.route53.Zone("williamhill-dev1.com")
            } 


            let dnsRecords = new Array();


            for (let index = 0; index < nodes.cacheNodes.get.length; index++) {
                let dnsRecord = new aws.route53.Record(this.config.require("targetDomain"), {
                    name: "redis-node-" + index.toString(),
                    zoneId: dnsZone.zoneId,
                    type: "A",

                });
                dnsRecords.push(dnsRecord);
            }
            return dnsRecords;
        }
        let dnsRecords = createDNS(dataService);


        let dataServiceEnvironment = {
            "REDIS_HOST": dataService.cacheNodes.apply(n => n[0].address),
            "REDIS_PORT": dataService.cacheNodes.apply(n => n[0].port.toString())
        }

        let webService = new cloud.Service("nginx", {

            containers: {
                nginx: {
                    build: "../app",
                    memory: this.dockerConfig.requireNumber("memory"),
                    ports: [{port: this.dockerConfig.requireObject("ports")}],
                    environment: dataServiceEnvironment
                }
            }
        });

    }
}


