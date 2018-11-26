
import * as cloud from "@pulumi/cloud-aws"
import * as aws from "@pulumi/aws"
import * as pulumi from "@pulumi/pulumi"
import { AWSQuicksightAthenaAccess } from "@pulumi/aws/iam";
import { groupBy } from "@pulumi/pulumi/iterable";


export class infrastructure {

    private rdsConfig : pulumi.Config ;
    private dockerConfig : pulumi.Config ;
    constructor() {
        this.rdsConfig = new pulumi.Config("elasticcache");
        this.dockerConfig = new pulumi.Config("docker");
    }

    createInfrastructure(): void {


        //create security groupBy, based on the nginx exteral ports
        let securityGroup = new aws.ec2.SecurityGroup("webserver-secgrp", { 
            ingress: [
                { 
                    protocol: "tcp", 
                    fromPort: <number><any>this.dockerConfig.requireObject("ports"), 
                    toPort: <number><any>this.dockerConfig.requireObject("ports"), 
                    cidrBlocks: ["0.0.0.0/0"] 
                }
            ]
        });

    
        //pull all security groups from the cloud
        let securityGroupIds = [cloud.getCluster()!.securityGroupId!];

        //get all the subnets assigned to elasticache
        let cacheSubnets = new aws.elasticache.SubnetGroup("cachesubnets", {
            subnetIds: cloud.getNetwork().subnetIds,
        });

        //create the elasticcashe resource
        let dataService = new aws.elasticache.Cluster("webcache", {
            clusterId: "cache-" + pulumi.getStack(),
            engine: "redis",

            nodeType: this.rdsConfig.require("nodeType"),
            numCacheNodes: this.rdsConfig.requireNumber("cacheNodes"),

            subnetGroupName: cacheSubnets.id,
            securityGroupIds: securityGroupIds,
            
        })

        //create the DNS Zone and Records for Elasticcache, so Nginx can use DNS to connect to Redis
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


        //Just in case we want to export some variables
        let dataServiceEnvironment = {
            "REDIS_HOST": dataService.cacheNodes.apply(n => n[0].address),
            "REDIS_PORT": dataService.cacheNodes.apply(n => n[0].port.toString())
        }

        //build and deploy the docker container running nginx, which will connect to redis over DNS
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


