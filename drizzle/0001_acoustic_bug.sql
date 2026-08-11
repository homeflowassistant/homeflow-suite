CREATE TABLE `ghl_installations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`locationId` varchar(128) NOT NULL,
	`companyId` varchar(128),
	`accessToken` text NOT NULL,
	`refreshToken` text NOT NULL,
	`expiresAt` bigint NOT NULL,
	`scopes` text,
	`userId` varchar(128),
	`workflowId` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ghl_installations_id` PRIMARY KEY(`id`),
	CONSTRAINT `ghl_installations_locationId_unique` UNIQUE(`locationId`)
);
